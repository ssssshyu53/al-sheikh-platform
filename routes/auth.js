const crypto = require('node:crypto');
const {
  db,
  hashPasswordAsync,
  verifyPasswordAsync,
  generateSecureOtp,
  hashOtpAsync,
  verifyOtpHashAsync
} = require('../database');
const {
  NODE_ENV,
  HAS_WHATSAPP_GATEWAY,
  ALLOW_UNVERIFIED_REGISTRATION,
  DUMMY_HASH,
  PREP_GRADES,
  VALID_GRADES,
  normalizeDigits,
  normalizePhoneNumber,
  safeDecode,
  isValidDeviceId,
  sanitizeUser
} = require('../lib/constants');
const { DEMO_STUDENT, shouldSeedDemoAccounts } = require('../lib/demo-seed');
const {
  checkRateLimit,
  parseCookies,
  buildAuthCookies,
  clearAuthCookies,
  sendJson,
  parseBody
} = require('../middleware/security');
const { createToken, getAuthUser, requireAuth } = require('../middleware/auth');
const { writeAuditLog, recordSharedDeviceIfAny } = require('../services/audit');
const { dispatchWhatsApp } = require('../services/whatsapp');
const { runInTransaction, getPlatformSetting, validateVoucherForPhoneAndGrade } = require('../services/gating');

async function applyVoucherSubscriptionInTx(tx, { userId, existingExpiresAt, existingSubscribedSubjects, voucher, nowMs }) {
  const nowIso = new Date(nowMs).toISOString();
  const durationMs = Number(voucher.duration_days) * 24 * 60 * 60 * 1000;
  const currentExpMs = existingExpiresAt ? new Date(existingExpiresAt).getTime() : 0;
  const hasActiveAll = existingSubscribedSubjects === 'all' && currentExpMs > nowMs;

  if (voucher.subject_scope === 'all') {
    const baseMs = hasActiveAll ? currentExpMs : nowMs;
    const newExpiresAt = new Date(baseMs + durationMs).toISOString();
    await tx.run(
      `UPDATE users SET subscription_expires_at = ?, subscribed_subjects = 'all' WHERE id = ?`,
      [newExpiresAt, userId]
    );
    return { newExpiresAt, voucherExpiresAt: newExpiresAt, newSubjects: 'all' };
  }

  const existingSubRow = await tx.get(
    `SELECT expires_at FROM user_subject_subscriptions WHERE user_id = ? AND subject = ?`,
    [userId, voucher.subject_scope]
  );
  const subjExpMs = existingSubRow?.expires_at ? new Date(existingSubRow.expires_at).getTime() : 0;
  const subjBaseMs = subjExpMs > nowMs ? subjExpMs : nowMs;
  const newSubjExpiresAt = new Date(subjBaseMs + durationMs).toISOString();

  const upsertSubSql = tx.isMysql
    ? `INSERT INTO user_subject_subscriptions (user_id, subject, expires_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`
    : `INSERT INTO user_subject_subscriptions (user_id, subject, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, subject) DO UPDATE SET expires_at = excluded.expires_at`;
  await tx.run(upsertSubSql, [userId, voucher.subject_scope, newSubjExpiresAt]);

  if (hasActiveAll) {
    // Do not let a single-subject voucher extend an active 'all' wildcard subscription.
    return { newExpiresAt: existingExpiresAt, voucherExpiresAt: newSubjExpiresAt, newSubjects: 'all' };
  }

  const activeRows = await tx.all(
    `SELECT subject, expires_at FROM user_subject_subscriptions WHERE user_id = ? AND expires_at > ?`,
    [userId, nowIso]
  );
  const subjectsSet = new Set();
  let maxExpMs = 0;
  for (const row of activeRows) {
    if (row.subject) subjectsSet.add(row.subject);
    const ms = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (ms > maxExpMs) maxExpMs = ms;
  }
  if (subjectsSet.size === 0) {
    subjectsSet.add(voucher.subject_scope);
    maxExpMs = new Date(newSubjExpiresAt).getTime();
  }
  const newSubjects = Array.from(subjectsSet).join(',');
  const newExpiresAt = new Date(maxExpMs).toISOString();
  await tx.run(
    `UPDATE users SET subscription_expires_at = ?, subscribed_subjects = ? WHERE id = ?`,
    [newExpiresAt, newSubjects, userId]
  );
  return { newExpiresAt, voucherExpiresAt: newSubjExpiresAt, newSubjects };
}

function isUniqueConstraintError(err) {
  if (!err) return false;
  return err.code === 'ER_DUP_ENTRY'
    || err.code === 'SQLITE_CONSTRAINT_UNIQUE'
    || /UNIQUE constraint failed/i.test(String(err.message || ''));
}

async function handleAuthRoutes(req, res, ctx) {
  const { pathname, clientIp } = ctx;

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (!checkRateLimit(`reg:${clientIp}`, 60, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'محاولات كثيرة جداً. يرجى الانتظار ١٥ دقيقة والمحاولة مرة أخرى.' });
      return true;
    }

    const body = await parseBody(req, 32 * 1024);
    const fullName = String(body.full_name || '').trim();
    const phone = normalizePhoneNumber(body.phone);
    const parentPhone = normalizePhoneNumber(body.parent_phone);
    const grade = String(body.grade || 'grade_3');
    const rawBranch = String(body.branch || (PREP_GRADES.includes(grade) ? 'general' : 'scientific'));
    const branch = PREP_GRADES.includes(grade) ? 'general' : rawBranch;
    const password = String(body.password || '');
    const activationCode = normalizeDigits(body.activation_code || body.voucher_code || body.code || '').trim().toUpperCase();
    const deviceId = String(req.headers['x-device-id'] || body.device_id || '').trim();
    const deviceName = safeDecode(req.headers['x-device-name'] || body.device_name || 'متصفح الطالب', 'متصفح الطالب').slice(0, 120);

    const nameParts = fullName.split(/\s+/).filter(Boolean);
    if (nameParts.length < 4 || fullName.length > 120) {
      sendJson(req, res, 400, { error: 'يرجى كتابة اسم الطالب رباعياً بالكامل (٤ أسماء على الأقل).' });
      return true;
    }
    if (!/^01[0125]\d{8}$/.test(phone)) {
      sendJson(req, res, 400, { error: 'يرجى إدخال رقم هاتف طالب مصري صحيح مكون من ١١ رقماً.' });
      return true;
    }
    if (!checkRateLimit(`reg_phone:${phone}`, 5, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز عدد محاولات التسجيل لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    if (!/^01[0125]\d{8}$/.test(parentPhone)) {
      sendJson(req, res, 400, { error: 'يرجى إدخال رقم هاتف ولي أمر صحيح مكون من ١١ رقماً.' });
      return true;
    }
    if (phone === parentPhone) {
      sendJson(req, res, 400, { error: 'يجب أن يكون رقم هاتف ولي الأمر مختلفاً عن رقم هاتف الطالب.' });
      return true;
    }
    if (!VALID_GRADES.includes(grade) || (!PREP_GRADES.includes(grade) && !['scientific', 'literary'].includes(branch))) {
      sendJson(req, res, 400, { error: 'الصف الدراسي أو الشعبة غير صالحة.' });
      return true;
    }
    if (password.length < 8 || password.length > 128) {
      sendJson(req, res, 400, { error: 'كلمة المرور يجب ألا تقل عن ٨ أحرف أو أرقام.' });
      return true;
    }
    if (!isValidDeviceId(deviceId)) {
      sendJson(req, res, 400, { error: 'معرف الجهاز غير صالح (يجب أن يكون من ٦ إلى ١٠٠ حرف بالإنجليزية أو الأرقام).' });
      return true;
    }

    const registrationMode = HAS_WHATSAPP_GATEWAY
      ? 'whatsapp_otp'
      : (ALLOW_UNVERIFIED_REGISTRATION ? 'direct' : (NODE_ENV === 'test' ? 'whatsapp_otp' : 'voucher_code'));

    if (registrationMode === 'voucher_code' && !activationCode) {
      sendJson(req, res, 400, {
        error: 'يرجى إدخال كود التفعيل. إذا لم يكن معك كود، اضغط «تواصل مع الدعم» بعد التحويل لطلبه.'
      });
      return true;
    }
    if (activationCode && activationCode.length > 40) {
      sendJson(req, res, 400, { error: 'صيغة كود التفعيل غير صحيحة.' });
      return true;
    }

    const existing = await db.get(`SELECT id, is_whatsapp_verified FROM users WHERE phone = ?`, [phone]);
    const useVoucherRegistration = Boolean(activationCode);
    const requireOtp = !useVoucherRegistration && registrationMode === 'whatsapp_otp';

    if (existing) {
      if (!requireOtp) {
        sendJson(req, res, 400, {
          error: 'رقم الهاتف مسجل بالفعل. يرجى تسجيل الدخول بحسابك واستخدام كود الشحن من الداخل.'
        });
        return true;
      }
      const otpCode = generateSecureOtp();
      const otpHash = await hashOtpAsync(otpCode);
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      if (!existing.is_whatsapp_verified) {
        const pwHash = await hashPasswordAsync(password);
        await db.run(
          `UPDATE users
           SET full_name = ?, parent_phone = ?, password_hash = ?, grade = ?, branch = ?,
               device_id = ?, device_name = ?, device_locked_at = ?,
               whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_purpose = 'register', otp_attempts = 0,
               otp_last_sent_at = ?, token_version = token_version + 1
           WHERE id = ? AND is_whatsapp_verified = 0`,
          [
            fullName,
            parentPhone,
            pwHash,
            grade,
            branch,
            deviceId,
            deviceName,
            now,
            otpHash,
            otpExpires,
            now,
            existing.id
          ]
        );
        await dispatchWhatsApp(phone, fullName, 'otp', `رمز تفعيل حسابك في منصة مَتْن هو: ${otpCode}`);
      }
      sendJson(req, res, 201, {
        message: 'إذا لم يكن الرقم مسجلاً مسبقاً، فقد تم إرسال كود التأكيد إلى الواتساب. يرجى إدخال الكود المكون من ٦ أرقام.',
        phone
      });
      return true;
    }

    const pwHash = await hashPasswordAsync(password);
    const now = new Date().toISOString();

    if (useVoucherRegistration) {
      let regVoucherRes;
      try {
        regVoucherRes = await runInTransaction(async (tx) => {
          const voucherSql = tx.isMysql
            ? `SELECT * FROM vouchers WHERE code = ? ${tx.forUpdate()}`
            : `SELECT * FROM vouchers WHERE UPPER(code) = ?`;
          const voucher = await tx.get(voucherSql, [activationCode]);
          const vCheck = validateVoucherForPhoneAndGrade(voucher, phone, grade, 400);
          if (!vCheck.ok) return vCheck;

          const insUser = await tx.run(
            `INSERT INTO users (
               full_name, phone, parent_phone, password_hash, role, grade, branch,
               is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_purpose,
               otp_attempts, otp_resend_count, otp_last_sent_at,
               device_id, device_name, device_locked_at,
               subscription_expires_at, subscribed_subjects, created_at
             ) VALUES (?, ?, ?, ?, 'student', ?, ?, 1, NULL, NULL, NULL, 0, 0, NULL, ?, ?, ?, NULL, '', ?)`,
            [
              fullName,
              phone,
              parentPhone,
              pwHash,
              grade,
              branch,
              deviceId,
              deviceName,
              now,
              now
            ]
          );

          const newUserId = insUser.lastInsertRowid;
          const subRes = await applyVoucherSubscriptionInTx(tx, {
            userId: newUserId,
            existingExpiresAt: null,
            existingSubscribedSubjects: '',
            voucher,
            nowMs: Date.now()
          });

          const vUpd = await tx.run(
            `UPDATE vouchers
             SET is_used = 1, used_by_user_id = ?, used_at = ?, expires_after_use_at = ?
             WHERE id = ? AND is_used = 0`,
            [newUserId, now, subRes.voucherExpiresAt, voucher.id]
          );

          if (vUpd.changes !== 1) {
            throw new Error('VOUCHER_RACE_CONFLICT');
          }

          const createdUser = await tx.get(`SELECT * FROM users WHERE id = ?`, [newUserId]);
          return { ok: true, createdUser, voucher, newExpiresAt: subRes.newExpiresAt };
        });
      } catch (err) {
        if (err && err.message === 'VOUCHER_RACE_CONFLICT') {
          sendJson(req, res, 409, { error: 'تم استخدام كود التفعيل بالفعل في عملية أخرى.' });
          return true;
        }
        if (isUniqueConstraintError(err)) {
          sendJson(req, res, 409, { error: 'رقم الهاتف مسجل بالفعل. يرجى تسجيل الدخول بحسابك.' });
          return true;
        }
        throw err;
      }

      if (!regVoucherRes.ok) {
        sendJson(req, res, regVoucherRes.status, { error: regVoucherRes.error });
        return true;
      }

      const { createdUser, voucher, newExpiresAt } = regVoucherRes;
      await recordSharedDeviceIfAny(createdUser.id, createdUser.full_name, createdUser.phone, createdUser.device_id);
      writeAuditLog(req, createdUser, 'VOUCHER_REGISTRATION_ACTIVATED', 'voucher', voucher.id, {
        phone,
        duration_days: voucher.duration_days
      });

      const token = createToken(createdUser);
      const csrfToken = crypto.randomBytes(24).toString('hex');

      sendJson(req, res, 201, {
        message: `تم إنشاء حسابك وتفعيل اشتراكك لمدة ${voucher.duration_days} يوماً بنجاح.`,
        auto_verified: true,
        expires_at: newExpiresAt,
        token,
        csrf_token: csrfToken,
        user: sanitizeUser(createdUser)
      }, {
        'Set-Cookie': buildAuthCookies(token, csrfToken, createdUser.device_id)
      });
      return true;
    }

    if (!requireOtp) {
      let insUser;
      try {
        insUser = await db.run(
          `INSERT INTO users (
             full_name, phone, parent_phone, password_hash, role, grade, branch,
             is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_purpose,
             otp_attempts, otp_resend_count, otp_last_sent_at,
             device_id, device_name, device_locked_at, subscribed_subjects, created_at
           ) VALUES (?, ?, ?, ?, 'student', ?, ?, 1, NULL, NULL, NULL, 0, 0, NULL, ?, ?, ?, '', ?)`,
          [
            fullName,
            phone,
            parentPhone,
            pwHash,
            grade,
            branch,
            deviceId,
            deviceName,
            now,
            now
          ]
        );
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          sendJson(req, res, 409, { error: 'رقم الهاتف مسجل بالفعل. يرجى تسجيل الدخول بحسابك.' });
          return true;
        }
        throw err;
      }

      const createdUser = await db.get(`SELECT * FROM users WHERE id = ?`, [insUser.lastInsertRowid]);
      await recordSharedDeviceIfAny(createdUser.id, createdUser.full_name, createdUser.phone, createdUser.device_id);
      writeAuditLog(req, createdUser, 'UNVERIFIED_REGISTRATION_AUTO_APPROVED', 'user', createdUser.id, { phone });

      const token = createToken(createdUser);
      const csrfToken = crypto.randomBytes(24).toString('hex');

      sendJson(req, res, 201, {
        message: 'تم إنشاء حسابك وتفعيله بنجاح! مرحباً بك في منصة مَتْن.',
        auto_verified: true,
        token,
        csrf_token: csrfToken,
        user: sanitizeUser(createdUser)
      }, {
        'Set-Cookie': buildAuthCookies(token, csrfToken, createdUser.device_id)
      });
      return true;
    }

    const otpCode = generateSecureOtp();
    const otpHash = await hashOtpAsync(otpCode);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    let insUser;
    try {
      insUser = await db.run(
        `INSERT INTO users (
           full_name, phone, parent_phone, password_hash, role, grade, branch,
           is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_purpose,
           otp_attempts, otp_resend_count, otp_last_sent_at,
           device_id, device_name, device_locked_at, subscribed_subjects, created_at
         ) VALUES (?, ?, ?, ?, 'student', ?, ?, 0, ?, ?, 'register', 0, 0, ?, ?, ?, ?, '', ?)`,
        [
          fullName,
          phone,
          parentPhone,
          pwHash,
          grade,
          branch,
          otpHash,
          otpExpires,
          now,
          deviceId,
          deviceName,
          now,
          now
        ]
      );
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        sendJson(req, res, 409, { error: 'رقم الهاتف مسجل بالفعل. يرجى تسجيل الدخول بحسابك.' });
        return true;
      }
      throw err;
    }

    await recordSharedDeviceIfAny(insUser.lastInsertRowid, fullName, phone, deviceId);
    await dispatchWhatsApp(phone, fullName, 'otp', `رمز تفعيل حسابك في منصة مَتْن هو: ${otpCode}`);

    sendJson(req, res, 201, {
      message: 'إذا لم يكن الرقم مسجلاً مسبقاً، فقد تم إرسال كود التأكيد إلى الواتساب. يرجى إدخال الكود المكون من ٦ أرقام.',
      phone
    });
    return true;
  }

  if (pathname === '/api/auth/resend-otp' && req.method === 'POST') {
    if (!checkRateLimit(`resend:${clientIp}`, 60, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'يرجى الانتظار قبل طلب إرسال الكود مرة أخرى.' });
      return true;
    }

    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    if (phone && !checkRateLimit(`resend_phone:${phone}`, 5, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز حد إعادة إرسال الكود لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }

    const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
    if (!user || user.is_whatsapp_verified || user.role !== 'student' || user.is_locked) {
      sendJson(req, res, 200, {
        message: 'تم إرسال طلب إعادة إرسال الكود في حال كان الحساب بانتظار التفعيل.'
      });
      return true;
    }

    const lastSent = user.otp_last_sent_at ? new Date(user.otp_last_sent_at).getTime() : 0;
    const elapsedSec = Math.floor((Date.now() - lastSent) / 1000);
    if (elapsedSec < 60) {
      sendJson(req, res, 429, {
        error: `يرجى الانتظار ${60 - elapsedSec} ثانية قبل إعادة طلب الكود.`
      });
      return true;
    }
    if ((user.otp_resend_count || 0) >= 3) {
      sendJson(req, res, 429, {
        error: 'لقد تجاوزت الحد الأقصى لإعادة إرسال الكود (٣ مرات). يرجى التواصل مع الإدارة.'
      });
      return true;
    }

    const otpCode = generateSecureOtp();
    const otpHash = await hashOtpAsync(otpCode);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await db.run(
      `UPDATE users
       SET whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_purpose = 'register', otp_attempts = 0,
           otp_resend_count = otp_resend_count + 1, otp_last_sent_at = ?
       WHERE id = ?`,
      [otpHash, otpExpires, now, user.id]
    );

    await dispatchWhatsApp(phone, user.full_name, 'otp', `رمز تفعيل حسابك في منصة مَتْن هو: ${otpCode}`);

    sendJson(req, res, 200, {
      message: 'تم إعادة إرسال كود التأكيد إلى رقم الواتساب الخاص بك.'
    });
    return true;
  }

  if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
    if (!checkRateLimit(`verify:${clientIp}`, 60, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'محاولات تحقق كثيرة جداً. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }

    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    const otpCode = normalizeDigits(body.otp_code).trim();
    const deviceId = String(req.headers['x-device-id'] || body.device_id || '').trim();
    const deviceName = safeDecode(req.headers['x-device-name'] || body.device_name || 'جهاز الطالب', 'جهاز الطالب').slice(0, 120);

    if (phone && !checkRateLimit(`verify_phone:${phone}`, 10, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز محاولات التحقق لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    if (!isValidDeviceId(deviceId)) {
      sendJson(req, res, 400, { error: 'معرف الجهاز غير صالح.' });
      return true;
    }

    const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
    if (!user || !user.whatsapp_otp_hash || user.role !== 'student' || user.is_locked || user.is_whatsapp_verified || (user.otp_purpose && user.otp_purpose !== 'register')) {
      sendJson(req, res, 400, { error: 'كود التأكيد غير صحيح أو منتهي الصلاحية.' });
      return true;
    }

    if ((user.otp_attempts || 0) >= 5) {
      sendJson(req, res, 429, { error: 'تم إيقاف الكود الحالي لتجاوز ٥ محاولات خاطئة. يرجى طلب إعادة إرسال كود جديد.' });
      return true;
    }

    const expTime = user.whatsapp_otp_expires ? new Date(user.whatsapp_otp_expires).getTime() : 0;
    if (Date.now() > expTime) {
      sendJson(req, res, 400, { error: 'انتهت صلاحية كود التأكيد. يرجى الضغط على إعادة إرسال الكود.' });
      return true;
    }

    if (!(await verifyOtpHashAsync(otpCode, user.whatsapp_otp_hash))) {
      await db.run(`UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?`, [user.id]);
      sendJson(req, res, 400, { error: 'كود التأكيد غير صحيح.' });
      return true;
    }

    if (user.device_id && deviceId !== user.device_id) {
      sendJson(req, res, 403, {
        error_code: 'DEVICE_LOCKED',
        error: 'يجب تأكيد الحساب من نفس الجهاز الذي تم التسجيل به.'
      });
      return true;
    }

    const now = new Date().toISOString();
    await db.run(
      `UPDATE users
       SET is_whatsapp_verified = 1, whatsapp_otp_hash = NULL, whatsapp_otp_expires = NULL, otp_purpose = NULL,
           otp_attempts = 0, device_id = COALESCE(device_id, ?), device_name = COALESCE(device_name, ?),
           device_locked_at = COALESCE(device_locked_at, ?)
       WHERE id = ?`,
      [deviceId, deviceName, now, user.id]
    );

    const updatedUser = await db.get(`SELECT * FROM users WHERE id = ?`, [user.id]);
    await recordSharedDeviceIfAny(updatedUser.id, updatedUser.full_name, updatedUser.phone, updatedUser.device_id);

    const token = createToken(updatedUser);
    const csrfToken = crypto.randomBytes(24).toString('hex');

    sendJson(req, res, 200, {
      message: 'تم تأكيد رقم الواتساب وتفعيل الحساب بنجاح!',
      token,
      csrf_token: csrfToken,
      user: sanitizeUser(updatedUser)
    }, {
      'Set-Cookie': buildAuthCookies(token, csrfToken, updatedUser.device_id)
    });
    return true;
  }

  if (pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    if (!checkRateLimit(`forgot:${clientIp}`, 60, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'محاولات كثيرة جداً. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    if (!/^01[0125]\d{8}$/.test(phone)) {
      sendJson(req, res, 400, { error: 'يرجى إدخال رقم هاتف مصري صحيح مكون من ١١ رقماً.' });
      return true;
    }
    if (!checkRateLimit(`forgot_phone:${phone}`, 5, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز حد طلبات استعادة كلمة المرور لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }

    if (!HAS_WHATSAPP_GATEWAY) {
      const supportWa = await getPlatformSetting('support_whatsapp', '01026379242');
      sendJson(req, res, 503, {
        error: `خدمة استعادة كلمة المرور عبر الواتساب غير مفعّلة حالياً. يرجى التواصل مع الإدارة على رقم الدعم (${supportWa}) لتعيين كلمة مرور مؤقتة.`,
        support_whatsapp: supportWa
      });
      return true;
    }

    const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
    if (user && !user.is_locked) {
      const lastSent = user.otp_last_sent_at ? new Date(user.otp_last_sent_at).getTime() : 0;
      const elapsedSec = Math.floor((Date.now() - lastSent) / 1000);
      if (elapsedSec >= 60) {
        const otpCode = generateSecureOtp();
        const otpHash = await hashOtpAsync(otpCode);
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const now = new Date().toISOString();
        await db.run(
          `UPDATE users
           SET whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_purpose = 'password_reset', otp_attempts = 0, otp_last_sent_at = ?
           WHERE id = ?`,
          [otpHash, otpExpires, now, user.id]
        );
        await dispatchWhatsApp(phone, user.full_name, 'otp', `رمز إعادة تعيين كلمة المرور في منصة مَتْن هو: ${otpCode}`);
        writeAuditLog(req, user, 'PASSWORD_RESET_OTP_SENT', 'user', user.id);
      }
    }

    sendJson(req, res, 200, {
      message: 'إذا كان الرقم مسجلاً لدينا، فقد تم إرسال رمز استعادة كلمة المرور إلى الواتساب.'
    });
    return true;
  }

  if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
    if (!checkRateLimit(`resetpw:${clientIp}`, 60, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'محاولات كثيرة جداً. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    const otpCode = normalizeDigits(body.otp_code).trim();
    const newPassword = String(body.new_password || '');

    if (!/^01[0125]\d{8}$/.test(phone)) {
      sendJson(req, res, 400, { error: 'رقم الهاتف غير صالح.' });
      return true;
    }
    if (!checkRateLimit(`resetpw_phone:${phone}`, 5, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز محاولات تغيير كلمة المرور لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      sendJson(req, res, 400, { error: 'كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف أو أرقام.' });
      return true;
    }

    const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
    const validResetPurpose = user && (user.otp_purpose === 'password_reset' || (!user.otp_purpose && Boolean(user.is_whatsapp_verified)));
    if (!user || !user.whatsapp_otp_hash || user.is_locked || !validResetPurpose) {
      sendJson(req, res, 400, { error: 'كود الاستعادة غير صحيح أو منتهي الصلاحية.' });
      return true;
    }
    if (user.role === 'admin' && newPassword.length < 12) {
      sendJson(req, res, 400, { error: 'كلمة مرور حساب الإدارة يجب ألا تقل عن ١٢ حرفاً.' });
      return true;
    }
    if ((user.otp_attempts || 0) >= 5) {
      sendJson(req, res, 429, { error: 'تم إيقاف الكود لتجاوز ٥ محاولات خاطئة. يرجى طلب كود جديد.' });
      return true;
    }
    const expTime = user.whatsapp_otp_expires ? new Date(user.whatsapp_otp_expires).getTime() : 0;
    if (Date.now() > expTime) {
      sendJson(req, res, 400, { error: 'انتهت صلاحية كود الاستعادة. يرجى طلب كود جديد.' });
      return true;
    }
    if (!(await verifyOtpHashAsync(otpCode, user.whatsapp_otp_hash))) {
      await db.run(`UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?`, [user.id]);
      sendJson(req, res, 400, { error: 'كود الاستعادة غير صحيح.' });
      return true;
    }

    const newHash = await hashPasswordAsync(newPassword);
    await db.run(
      `UPDATE users
       SET password_hash = ?, whatsapp_otp_hash = NULL, whatsapp_otp_expires = NULL, otp_purpose = NULL,
           otp_attempts = 0, failed_login_attempts = 0, last_failed_login_at = NULL,
           login_locked_until = NULL, token_version = token_version + 1
       WHERE id = ?`,
      [newHash, user.id]
    );
    await db.run(`DELETE FROM login_attempts WHERE phone = ?`, [phone]);

    writeAuditLog(req, user, 'PASSWORD_RESET_COMPLETED', 'user', user.id);
    sendJson(req, res, 200, { message: 'تم تغيير كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن.' });
    return true;
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    const password = String(body.password || '');
    const cookies = parseCookies(req);
    const deviceId = String(req.headers['x-device-id'] || body.device_id || cookies.matn_device_binding || '').trim();
    const deviceName = safeDecode(req.headers['x-device-name'] || body.device_name || 'جهاز غير معروف', 'جهاز غير معروف').slice(0, 120);

    if (!checkRateLimit(`login:${clientIp}:${phone}`, 15, 10 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز عدد محاولات تسجيل الدخول المسموحة. يرجى الانتظار ١٠ دقائق.' });
      return true;
    }

    const user = await db.get(`SELECT * FROM users WHERE phone = ?`, [phone]);
    const ipAttemptRow = await db.get(
      `SELECT failed_attempts, last_failed_at, locked_until
       FROM login_attempts
       WHERE ip_address = ? AND phone = ?`,
      [clientIp, phone]
    );

    if (ipAttemptRow && ipAttemptRow.locked_until && new Date(ipAttemptRow.locked_until).getTime() > Date.now()) {
      sendJson(req, res, 429, { error: 'تم قفل محاولات الدخول من هذا العنوان لهذا الحساب مؤقتاً لمدة ٣٠ دقيقة بسبب تكرار المحاولات الخاطئة.' });
      return true;
    }

    const pwCheck = await verifyPasswordAsync(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !pwCheck.valid) {
      let progressiveDelayMs = 0;
      if (user) {
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        const lastGlobalMs = user.last_failed_login_at ? new Date(user.last_failed_login_at).getTime() : 0;
        const globalWithinHour = lastGlobalMs && (nowMs - lastGlobalMs < 60 * 60 * 1000);
        const nextGlobalAttempts = (globalWithinHour ? (user.failed_login_attempts || 0) : 0) + 1;

        const lastIpMs = ipAttemptRow?.last_failed_at ? new Date(ipAttemptRow.last_failed_at).getTime() : 0;
        const ipWithinHour = lastIpMs && (nowMs - lastIpMs < 60 * 60 * 1000);
        const nextIpAttempts = (ipWithinHour ? (ipAttemptRow.failed_attempts || 0) : 0) + 1;

        await db.run(
          `UPDATE users SET failed_login_attempts = ?, last_failed_login_at = ?, login_locked_until = NULL WHERE id = ?`,
          [nextGlobalAttempts, nowIso, user.id]
        );

        if (user.role === 'admin') {
          const lockIpForAdmin = nextIpAttempts >= 15;
          const lockedUntilIso = lockIpForAdmin ? new Date(nowMs + 30 * 60 * 1000).toISOString() : null;
          const storedFailures = lockIpForAdmin ? 0 : nextIpAttempts;
          const adminAttemptSql = db.isMysql
            ? `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
               VALUES (?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 failed_attempts = VALUES(failed_attempts),
                 last_failed_at = VALUES(last_failed_at),
                 locked_until = VALUES(locked_until)`
            : `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(ip_address, phone) DO UPDATE SET
                 failed_attempts = excluded.failed_attempts,
                 last_failed_at = excluded.last_failed_at,
                 locked_until = excluded.locked_until`;
          await db.run(adminAttemptSql, [clientIp, phone, storedFailures, nowIso, lockedUntilIso]);

          if (nextIpAttempts >= 5 && (nextIpAttempts === 5 || nextIpAttempts % 5 === 0 || nextGlobalAttempts % 10 === 0)) {
            await db.run(
              `INSERT INTO security_events (user_id, student_name, phone, event_type, details, created_at)
               VALUES (?, ?, ?, 'ADMIN_LOGIN_BRUTE_FORCE', ?, ?)`,
              [
                user.id,
                user.full_name || 'حساب الإدارة',
                user.phone,
                `محاولات دخول فاشلة متكررة على حساب الإدارة من IP: ${clientIp} (${nextIpAttempts} محاولة من هذا العنوان، ${nextGlobalAttempts} إجمالاً خلال الساعة)`,
                nowIso
              ]
            );
          }
          if (lockIpForAdmin) {
            writeAuditLog(req, user, 'ADMIN_IP_LOGIN_LOCKED', 'user', user.id, { role: user.role, ip: clientIp, scope: 'ip_phone' });
            sendJson(req, res, 429, { error: 'تم قفل محاولات الدخول من هذا العنوان مؤقتاً لمدة ٣٠ دقيقة بسبب تكرار المحاولات الخاطئة.' });
            return true;
          }
          progressiveDelayMs = Math.min(2500, nextIpAttempts * 200 + (nextGlobalAttempts >= 30 ? 800 : 0));
        } else {
          if (nextGlobalAttempts >= 30) {
            if (nextGlobalAttempts === 30 || nextGlobalAttempts % 10 === 0) {
              await db.run(
                `INSERT INTO security_events (user_id, student_name, phone, event_type, details, created_at)
                 VALUES (?, ?, ?, 'DISTRIBUTED_BRUTE_FORCE_ATTEMPT', ?, ?)`,
                [
                  user.id,
                  user.full_name || '',
                  user.phone,
                  `هجوم تخمين موزع على الحساب (${nextGlobalAttempts} محاولة فاشلة من عناوين مختلفة خلال ساعة؛ آخر IP: ${clientIp})`,
                  nowIso
                ]
              );
            }
            progressiveDelayMs = Math.min(2500, (nextGlobalAttempts - 29) * 250);
          }

          if (nextIpAttempts >= 10) {
            const lockedUntilIso = new Date(nowMs + 30 * 60 * 1000).toISOString();
            const lockAttemptSql = db.isMysql
              ? `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
                 VALUES (?, ?, 0, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   failed_attempts = 0,
                   last_failed_at = VALUES(last_failed_at),
                   locked_until = VALUES(locked_until)`
              : `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
                 VALUES (?, ?, 0, ?, ?)
                 ON CONFLICT(ip_address, phone) DO UPDATE SET
                   failed_attempts = 0,
                   last_failed_at = excluded.last_failed_at,
                   locked_until = excluded.locked_until`;
            await db.run(lockAttemptSql, [clientIp, phone, nowIso, lockedUntilIso]);
            writeAuditLog(req, user, 'ACCOUNT_LOGIN_LOCKED', 'user', user.id, { role: user.role, ip: clientIp, scope: 'ip_phone', reason: '10_failed_attempts' });
            sendJson(req, res, 429, { error: 'تم قفل محاولات الدخول من هذا العنوان لهذا الحساب لمدة ٣٠ دقيقة بعد ١٠ محاولات خاطئة.' });
            return true;
          }

          const incAttemptSql = db.isMysql
            ? `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
               VALUES (?, ?, ?, ?, NULL)
               ON DUPLICATE KEY UPDATE
                 failed_attempts = VALUES(failed_attempts),
                 last_failed_at = VALUES(last_failed_at)`
            : `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
               VALUES (?, ?, ?, ?, NULL)
               ON CONFLICT(ip_address, phone) DO UPDATE SET
                 failed_attempts = excluded.failed_attempts,
                 last_failed_at = excluded.last_failed_at`;
          await db.run(incAttemptSql, [clientIp, phone, nextIpAttempts, nowIso]);
        }
      }
      if (progressiveDelayMs > 0) {
        await new Promise((r) => setTimeout(r, progressiveDelayMs));
      }
      sendJson(req, res, 401, { error: 'رقم الهاتف أو كلمة المرور غير صحيحة.' });
      return true;
    }

    if (user.is_locked) {
      sendJson(req, res, 403, { error: 'هذا الحساب موقوف من قِبل الإدارة.' });
      return true;
    }

    await db.run(`DELETE FROM login_attempts WHERE ip_address = ? AND phone = ?`, [clientIp, phone]);
    await db.run(
      `UPDATE users
       SET failed_login_attempts = 0, last_failed_login_at = NULL, login_locked_until = NULL
           ${pwCheck.needsUpgrade && pwCheck.upgradedHash ? ', password_hash = ?' : ''}
       WHERE id = ?`,
      pwCheck.needsUpgrade && pwCheck.upgradedHash ? [pwCheck.upgradedHash, user.id] : [user.id]
    );

    if (user.role === 'admin') {
      const token = createToken(user);
      const csrfToken = crypto.randomBytes(24).toString('hex');
      writeAuditLog(req, user, 'ADMIN_LOGIN', 'user', user.id, { deviceName });
      sendJson(req, res, 200, {
        message: 'مرحباً بك في لوحة التحكم الإدارية.',
        token,
        csrf_token: csrfToken,
        user: sanitizeUser(user)
      }, {
        'Set-Cookie': buildAuthCookies(token, csrfToken, null)
      });
      return true;
    }

    if (!user.is_whatsapp_verified) {
      sendJson(req, res, 403, {
        error_code: 'WHATSAPP_NOT_VERIFIED',
        phone: user.phone,
        error: 'يرجى تأكيد حسابك أولاً بإدخال الكود المرسل إلى الواتساب.'
      });
      return true;
    }

    if (!isValidDeviceId(deviceId)) {
      sendJson(req, res, 403, {
        error_code: 'DEVICE_LOCKED',
        error: 'معرف الجهاز مفقود أو غير صالح. لا يمكن فتح حساب الطالب بدون بصمة الجهاز المعتمدة.'
      });
      return true;
    }

    const now = new Date().toISOString();
    const isDevDemoStudent = shouldSeedDemoAccounts() && user.phone === DEMO_STUDENT.phone;
    if (!user.device_id || (isDevDemoStudent && user.device_id !== deviceId)) {
      await db.run(
        `UPDATE users SET device_id = ?, device_name = ?, device_locked_at = ?, device_reset_requested = 0 WHERE id = ?`,
        [deviceId, deviceName, now, user.id]
      );
      user.device_id = deviceId;
      user.device_name = deviceName;
      if (!isDevDemoStudent) {
        await recordSharedDeviceIfAny(user.id, user.full_name, user.phone, deviceId);
      }
    } else if (user.device_id !== deviceId) {
      await db.run(`UPDATE users SET blocked_login_attempts = blocked_login_attempts + 1 WHERE id = ?`, [user.id]);
      await db.run(
        `INSERT INTO security_events (user_id, student_name, phone, event_type, details, created_at)
         VALUES (?, ?, ?, 'MULTI_DEVICE_BLOCKED', ?, ?)`,
        [
          user.id,
          user.full_name,
          user.phone,
          `محاولة دخول مرفوضة من جهاز مختلف (${deviceName})`,
          now
        ]
      );

      const supportWhatsapp = await getPlatformSetting('support_whatsapp', '');
      const waDigits = supportWhatsapp.replace(/[^\d]/g, '');
      const waIntl = waDigits.startsWith('0') ? `2${waDigits}` : waDigits;
      sendJson(req, res, 403, {
        error_code: 'DEVICE_LOCKED',
        error: 'حساب الطالب مربوط بجهاز آخر. يمكنك إرسال طلب إعادة تعيين الجهاز للإدارة.',
        registered_device: user.device_name || 'الجهاز الأساسي المسجل',
        support_whatsapp: supportWhatsapp,
        whatsapp_unlock_url: waIntl
          ? `https://wa.me/${waIntl}?text=${encodeURIComponent(`السلام عليكم، أنا الطالب (${user.full_name}) رقم هاتفي (${user.phone})، أرجو الموافقة على طلب إعادة تعيين جهازي.`)}`
          : ''
      });
      return true;
    } else {
      await recordSharedDeviceIfAny(user.id, user.full_name, user.phone, deviceId);
    }

    const token = createToken(user);
    const csrfToken = crypto.randomBytes(24).toString('hex');
    sendJson(req, res, 200, {
      message: 'تم تسجيل الدخول بنجاح!',
      token,
      csrf_token: csrfToken,
      user: sanitizeUser(user)
    }, {
      'Set-Cookie': buildAuthCookies(token, csrfToken, user.device_id)
    });
    return true;
  }

  if (pathname === '/api/auth/request-device-reset' && req.method === 'POST') {
    if (!checkRateLimit(`devreset:${clientIp}`, 20, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'يرجى الانتظار قبل إرسال طلب آخر.' });
      return true;
    }
    const body = await parseBody(req, 16 * 1024);
    const phone = normalizePhoneNumber(body.phone);
    if (phone && !checkRateLimit(`devreset_phone:${phone}`, 5, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز حد طلبات فك ارتباط الجهاز لهذا الرقم. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }
    const ipAttemptRow = phone
      ? await db.get(`SELECT failed_attempts, last_failed_at, locked_until FROM login_attempts WHERE ip_address = ? AND phone = ?`, [clientIp, phone])
      : null;
    if (ipAttemptRow && ipAttemptRow.locked_until && new Date(ipAttemptRow.locked_until).getTime() > Date.now()) {
      sendJson(req, res, 429, { error: 'تم قفل محاولات التحقق من هذا العنوان مؤقتاً لمدة ٣٠ دقيقة.' });
      return true;
    }

    const password = String(body.password || '');
    const user = await db.get(`SELECT * FROM users WHERE phone = ? AND role = 'student'`, [phone]);
    const pwCheck = await verifyPasswordAsync(password, user ? user.password_hash : DUMMY_HASH);
    if (user && pwCheck.valid) {
      await db.run(`DELETE FROM login_attempts WHERE ip_address = ? AND phone = ?`, [clientIp, phone]);
      await db.run(`UPDATE users SET device_reset_requested = 1 WHERE id = ?`, [user.id]);
      writeAuditLog(req, user, 'DEVICE_RESET_REQUESTED', 'user', user.id);
    } else if (user) {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const lastIpMs = ipAttemptRow?.last_failed_at ? new Date(ipAttemptRow.last_failed_at).getTime() : 0;
      const nextIpAttempts = ((lastIpMs && nowMs - lastIpMs < 60 * 60 * 1000) ? (ipAttemptRow.failed_attempts || 0) : 0) + 1;
      const shouldLock = nextIpAttempts >= 10;
      const lockSql = db.isMysql
        ? `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE failed_attempts = VALUES(failed_attempts), last_failed_at = VALUES(last_failed_at), locked_until = VALUES(locked_until)`
        : `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(ip_address, phone) DO UPDATE SET failed_attempts = excluded.failed_attempts, last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until`;
      await db.run(lockSql, [
        clientIp,
        phone,
        shouldLock ? 0 : nextIpAttempts,
        nowIso,
        shouldLock ? new Date(nowMs + 30 * 60 * 1000).toISOString() : null
      ]);
    }
    sendJson(req, res, 200, {
      message: 'تم تسجيل طلب إعادة تعيين الجهاز لدى الإدارة للمراجعة.'
    });
    return true;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = await getAuthUser(req);
    if (user && user.id) {
      await db.run(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`, [user.id]);
      writeAuditLog(req, user, 'USER_LOGOUT', 'user', user.id);
    }
    sendJson(req, res, 200, { message: 'تم تسجيل الخروج وإبطال الجلسة بنجاح.' }, {
      'Set-Cookie': clearAuthCookies()
    });
    return true;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    sendJson(req, res, 200, { user: sanitizeUser(user) });
    return true;
  }

  if (pathname === '/api/security/report' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    if (!checkRateLimit(`secrep:${user.id}:${clientIp}`, 5, 10 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'تم تجاوز حد إرسال التقارير الأمنية مؤقتاً.' });
      return true;
    }

    const ALLOWED_SECURITY_EVENTS = new Set([
      'UI_DETERRENT',
      'UI_DETERRENT_EVENT',
      'DEVTOOLS_ATTEMPT',
      'COPY_OR_PRINT_SHORTCUT',
      'SCREEN_CAPTURE_DETECTED',
      'VISIBILITY_VIOLATION'
    ]);
    const body = await parseBody(req, 16 * 1024);
    const eventType = String(body.event_type || 'UI_DETERRENT').trim();
    if (!ALLOWED_SECURITY_EVENTS.has(eventType)) {
      sendJson(req, res, 400, { error: 'نوع الحدث الأمني غير مدعوم.' });
      return true;
    }

    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO security_events (user_id, student_name, phone, event_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.full_name || 'طالب',
        user.phone || '',
        eventType,
        String(body.details || 'حدث واجهة').slice(0, 250),
        now
      ]
    );
    sendJson(req, res, 200, { logged: true });
    return true;
  }

  if (pathname === '/api/vouchers/redeem' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    if (!checkRateLimit(`voucher:${user.id}`, 10, 15 * 60 * 1000)) {
      sendJson(req, res, 429, { error: 'محاولات شحن كثيرة جداً. يرجى الانتظار ١٥ دقيقة.' });
      return true;
    }

    const body = await parseBody(req, 16 * 1024);
    const code = normalizeDigits(body.code).trim().toUpperCase();
    if (!code || code.length > 40) {
      sendJson(req, res, 400, { error: 'يرجى إدخال كود الشحن بشكل صحيح.' });
      return true;
    }

    const redeemRes = await runInTransaction(async (tx) => {
      const lockClause = tx.forUpdate();
      const voucherSql = tx.isMysql
        ? `SELECT * FROM vouchers WHERE code = ? ${lockClause}`
        : `SELECT * FROM vouchers WHERE UPPER(code) = ?`;
      const voucher = await tx.get(voucherSql, [code]);
      const vCheck = validateVoucherForPhoneAndGrade(voucher, user.phone, user.grade, 404);
      if (!vCheck.ok) return vCheck;

      const freshUser = await tx.get(`SELECT * FROM users WHERE id = ? ${lockClause}`, [user.id]);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const subRes = await applyVoucherSubscriptionInTx(tx, {
        userId: freshUser.id,
        existingExpiresAt: freshUser.subscription_expires_at,
        existingSubscribedSubjects: freshUser.subscribed_subjects,
        voucher,
        nowMs
      });

      const vUpd = await tx.run(
        `UPDATE vouchers SET is_used = 1, used_by_user_id = ?, used_at = ?, expires_after_use_at = ?
         WHERE id = ? AND is_used = 0`,
        [freshUser.id, nowIso, subRes.voucherExpiresAt, voucher.id]
      );

      if (vUpd.changes !== 1) {
        return { ok: false, status: 400, error: 'هذا الكود تم استخدامه مسبقاً.' };
      }

      const updatedUser = await tx.get(`SELECT * FROM users WHERE id = ?`, [freshUser.id]);
      return { ok: true, voucher, newExpiresAt: subRes.voucherExpiresAt, updatedUser };
    });

    if (!redeemRes.ok) {
      sendJson(req, res, redeemRes.status, { error: redeemRes.error });
      return true;
    }

    writeAuditLog(req, user, 'VOUCHER_REDEEM', 'voucher', redeemRes.voucher.id, { duration_days: redeemRes.voucher.duration_days });
    sendJson(req, res, 200, {
      message: `تم تفعيل الكود بنجاح! اشتراكك متاح لمدة ${redeemRes.voucher.duration_days} يوماً حتى ${new Date(redeemRes.newExpiresAt).toLocaleDateString('ar-EG')}.`,
      user: sanitizeUser(redeemRes.updatedUser),
      expires_at: redeemRes.newExpiresAt
    });
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };
