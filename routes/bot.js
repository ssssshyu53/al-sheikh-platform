const crypto = require('node:crypto');
const { db } = require('../database');
const { getBotPullToken, isBotPullConfigured, parsePositiveInt } = require('../lib/constants');
const { getCairoDateTimeParts, queueWeeklyReportsForWeek } = require('../lib/weekly-reports');
const { checkRateLimit, sendJson, parseBody } = require('../middleware/security');
const { runInTransaction } = require('../services/gating');

const LEASE_TIMEOUT_MS = 5 * 60 * 1000;

function timingSafeTokenMatch(provided, expected) {
  const bufA = Buffer.from(String(provided || ''), 'utf8');
  const bufB = Buffer.from(String(expected || ''), 'utf8');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authenticateBotRequest(req, res) {
  if (!isBotPullConfigured()) {
    sendJson(req, res, 503, { error: 'خدمة البوت الساحب غير مفعلة (BOT_PULL_TOKEN غير مضبوط أو أقل من ٣٢ حرفاً).' });
    return false;
  }

  const authHeader = String(req.headers['authorization'] || '');
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const expectedToken = getBotPullToken();

  if (!timingSafeTokenMatch(bearerToken, expectedToken)) {
    sendJson(req, res, 401, { error: 'رمز مصادقة البوت غير صحيح أو مفقود.' });
    return false;
  }
  return true;
}

async function handleBotRoutes(req, res, ctx) {
  const { pathname, clientIp } = ctx;
  if (!pathname.startsWith('/api/bot/')) return false;

  if (!checkRateLimit(`bot:${clientIp}`, 60, 60 * 1000)) {
    sendJson(req, res, 429, { error: 'تم تجاوز الحد المسموح لطلبات البوت في الدقيقة.' });
    return true;
  }

  if (!authenticateBotRequest(req, res)) {
    return true;
  }

  if (pathname === '/api/bot/weekly-reports/prepare' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const nowDate = new Date();
    const weekKey = String(body.week_key || '').trim() || getCairoDateTimeParts(nowDate).weekKey;
    if (weekKey.length > 32) {
      sendJson(req, res, 400, { error: 'معرف الأسبوع (week_key) يجب ألا يتجاوز ٣٢ حرفاً.' });
      return true;
    }

    await queueWeeklyReportsForWeek(db, {
      now: nowDate,
      weekKey,
      includeAllVerified: Boolean(body.include_all_verified)
    });

    const grouped = await db.all(
      `SELECT status, COUNT(*) AS c
       FROM weekly_parent_reports
       WHERE week_key = ?
       GROUP BY status`,
      [weekKey]
    );

    const counts = { total: 0, pending: 0, processing: 0, sent: 0, failed: 0 };
    for (const row of grouped) {
      const c = Number(row.c || 0);
      counts.total += c;
      if (row.status === 'pending' || row.status === 'manual_ready') counts.pending += c;
      else if (row.status === 'processing') counts.processing += c;
      else if (row.status === 'sent') counts.sent += c;
      else if (row.status === 'failed') counts.failed += c;
    }

    sendJson(req, res, 200, {
      ok: true,
      week_key: weekKey,
      ...counts
    });
    return true;
  }

  if (pathname === '/api/bot/weekly-reports/claim' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const nowMs = Date.now();
    const nowDate = new Date(nowMs);
    const nowIso = nowDate.toISOString();
    const weekKey = String(body.week_key || '').trim() || getCairoDateTimeParts(nowDate).weekKey;
    if (weekKey.length > 32) {
      sendJson(req, res, 400, { error: 'معرف الأسبوع (week_key) يجب ألا يتجاوز ٣٢ حرفاً.' });
      return true;
    }

    const leaseCutoffIso = new Date(nowMs - LEASE_TIMEOUT_MS).toISOString();
    const claimResult = await runInTransaction(async (tx) => {
      // Recover stalled processing items after lease expiration (5 min)
      await tx.run(
        `UPDATE weekly_parent_reports
         SET status = 'failed',
             error_reason = 'تجاوز الحد الأقصى لمحاولات الإرسال بعد انقطاع الاتصال',
             claimed_at = NULL
         WHERE week_key = ?
           AND status = 'processing'
           AND (claimed_at IS NULL OR claimed_at < ?)
           AND attempt_count >= 3`,
        [weekKey, leaseCutoffIso]
      );
      await tx.run(
        `UPDATE weekly_parent_reports
         SET status = 'pending',
             claimed_at = NULL
         WHERE week_key = ?
           AND status = 'processing'
           AND (claimed_at IS NULL OR claimed_at < ?)
           AND attempt_count < 3`,
        [weekKey, leaseCutoffIso]
      );

      const lockClause = tx.forUpdate();
      const candidate = await tx.get(
        `SELECT id, week_key, student_name, parent_phone, report_text, attempt_count
         FROM weekly_parent_reports
         WHERE week_key = ? AND status IN ('pending', 'manual_ready')
         ORDER BY id ASC
         LIMIT 1 ${lockClause}`,
        [weekKey]
      );

      if (!candidate) {
        return { item: null, remainingPending: 0 };
      }

      const upd = await tx.run(
        `UPDATE weekly_parent_reports
         SET status = 'processing',
             claimed_at = ?,
             attempt_count = attempt_count + 1
         WHERE id = ? AND status IN ('pending', 'manual_ready')`,
        [nowIso, candidate.id]
      );

      if (upd.changes !== 1) {
        return { item: null, remainingPending: 0 };
      }

      const remRow = await tx.get(
        `SELECT COUNT(*) AS c
         FROM weekly_parent_reports
         WHERE week_key = ? AND status IN ('pending', 'manual_ready')`,
        [weekKey]
      );

      return {
        item: {
          id: candidate.id,
          week_key: candidate.week_key,
          student_name: candidate.student_name,
          parent_phone: candidate.parent_phone,
          report_text: candidate.report_text,
          attempt_count: Number(candidate.attempt_count || 0) + 1
        },
        remainingPending: Number(remRow?.c || 0)
      };
    });

    sendJson(req, res, 200, {
      ok: true,
      item: claimResult.item,
      remaining_pending: claimResult.remainingPending
    });
    return true;
  }

  if (pathname.startsWith('/api/bot/weekly-reports/') && pathname.endsWith('/ack') && req.method === 'POST') {
    const reportId = parsePositiveInt(pathname.split('/')[4]);
    if (!reportId) {
      sendJson(req, res, 404, { error: 'التقرير غير موجود.' });
      return true;
    }

    const body = await parseBody(req, 16 * 1024);
    const ackStatus = String(body.status || '').trim();
    if (!['sent', 'failed'].includes(ackStatus)) {
      sendJson(req, res, 400, { error: 'حالة الإقرار (status) يجب أن تكون sent أو failed.' });
      return true;
    }

    const nowIso = new Date().toISOString();
    const safeReason = String(body.error_reason || 'فشل الإرسال عبر بوت الواتساب').trim().slice(0, 250);
    const providerMsgId = String(body.provider_message_id || '').trim().slice(0, 120);

    const ackOut = await runInTransaction(async (tx) => {
      const lockClause = tx.forUpdate();
      const row = await tx.get(
        `SELECT * FROM weekly_parent_reports WHERE id = ? ${lockClause}`,
        [reportId]
      );
      if (!row) {
        return { ok: false, status: 404, error: 'التقرير غير موجود.' };
      }
      if (row.status !== 'processing') {
        return { ok: false, status: 409, error: 'التقرير ليس قيد المعالجة ولا يمكن تعديل حالته الحالية.' };
      }

      if (ackStatus === 'sent') {
        const upd = await tx.run(
          `UPDATE weekly_parent_reports
           SET status = 'sent', sent_at = ?, error_reason = NULL, claimed_at = NULL
           WHERE id = ? AND status = 'processing'`,
          [nowIso, reportId]
        );
        if (upd.changes !== 1) {
          return { ok: false, status: 409, error: 'تعذر تحديث حالة التقرير.' };
        }
        await tx.run(
          `INSERT INTO whatsapp_logs (recipient_phone, student_name, message_type, message_summary, status, failure_reason, created_at)
           VALUES (?, ?, 'weekly_parent_report', ?, 'sent', NULL, ?)`,
          [
            row.parent_phone,
            row.student_name || '',
            `تقرير المتابعة الأسبوعي (${row.week_key})${providerMsgId ? ` [${providerMsgId}]` : ''}`,
            nowIso
          ]
        );
      } else {
        const upd = await tx.run(
          `UPDATE weekly_parent_reports
           SET status = 'failed', error_reason = ?, claimed_at = NULL
           WHERE id = ? AND status = 'processing'`,
          [safeReason, reportId]
        );
        if (upd.changes !== 1) {
          return { ok: false, status: 409, error: 'تعذر تحديث حالة التقرير.' };
        }
        await tx.run(
          `INSERT INTO whatsapp_logs (recipient_phone, student_name, message_type, message_summary, status, failure_reason, created_at)
           VALUES (?, ?, 'weekly_parent_report', ?, 'failed', ?, ?)`,
          [
            row.parent_phone,
            row.student_name || '',
            `تقرير المتابعة الأسبوعي (${row.week_key})`,
            safeReason,
            nowIso
          ]
        );
      }

      return { ok: true, id: reportId, status: ackStatus };
    });

    if (!ackOut.ok) {
      sendJson(req, res, ackOut.status, { error: ackOut.error });
      return true;
    }

    sendJson(req, res, 200, ackOut);
    return true;
  }

  return false;
}

module.exports = { handleBotRoutes };
