const { db } = require('../database');
const { isAllowedWhatsappGatewayUrl } = require('../lib/constants');

async function dispatchWhatsApp(recipientPhone, studentName, messageType, messageBody, logSummary) {
  const cleanPhone = String(recipientPhone || '').trim();
  const now = new Date().toISOString();
  const safeSummary = logSummary || (messageType === 'otp' ? 'إرسال رمز تحقق OTP (مشفر)' : 'إشعار منصة مَتْن');

  const logRow = await db.run(
    `INSERT INTO whatsapp_logs (recipient_phone, student_name, message_type, message_summary, status, failure_reason, created_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, ?)`,
    [cleanPhone, studentName || '', messageType, safeSummary, now]
  );
  const logId = logRow.lastInsertRowid;

  if (!/^(\+?20)?0?1[0125]\d{8}$/.test(cleanPhone.replace(/[\s\-()]/g, ''))) {
    await db.run(
      `UPDATE whatsapp_logs SET status = 'failed', failure_reason = 'Invalid recipient phone number' WHERE id = ?`,
      [logId]
    );
    return { delivered: false };
  }

  const apiUrl = String(process.env.WHATSAPP_API_URL || '').trim();
  const apiToken = process.env.WHATSAPP_API_TOKEN || '';

  if (!isAllowedWhatsappGatewayUrl(apiUrl)) {
    await db.run(
      `UPDATE whatsapp_logs SET status = 'pending', failure_reason = 'WHATSAPP_API_URL not configured (https:// or local 127.0.0.1 bot)' WHERE id = ?`,
      [logId]
    );
    return { delivered: false };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        token: apiToken,
        to: cleanPhone.startsWith('0') ? '+2' + cleanPhone : cleanPhone,
        body: messageBody,
        message_type: messageType
      })
    });

    const rawBody = await response.text().catch(() => '');
    let parsed = null;
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = null;
      }
    }

    const providerRejected = parsed && (
      parsed.ok === false
      || parsed.sent === false
      || parsed.success === false
      || Boolean(parsed.error)
    );

    if (response.ok && !providerRejected) {
      await db.run(`UPDATE whatsapp_logs SET status = 'sent', failure_reason = NULL WHERE id = ?`, [logId]);
      return { delivered: true };
    }
    const reason = parsed?.error
      ? String(parsed.error).slice(0, 180)
      : (providerRejected ? 'WhatsApp gateway reported delivery error' : `HTTP ${response.status}`);
    await db.run(`UPDATE whatsapp_logs SET status = 'failed', failure_reason = ? WHERE id = ?`, [reason, logId]);
    return { delivered: false };
  } catch (err) {
    const reason = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'timeout'
      : 'Network error communicating with WhatsApp gateway';
    await db.run(`UPDATE whatsapp_logs SET status = 'failed', failure_reason = ? WHERE id = ?`, [reason, logId]);
    return { delivered: false };
  }
}

module.exports = { dispatchWhatsApp };
