/**
 * Outgoing email. Every message is recorded in email_outbox. When SMTP is configured
 * the message is delivered with nodemailer; otherwise it is only logged (development),
 * and production refuses to pretend an email was sent.
 */
const nodemailer = require('nodemailer');
const { run } = require('../db');
const { SMTP, IS_PROD } = require('../config');
const { HttpError } = require('../utils/errors');

const transport = SMTP.host
  ? nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: SMTP.secure, auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined })
  : null;

if (!transport && IS_PROD) console.warn('[mail] SMTP_HOST is not set: emails cannot be delivered in production.');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, paragraphs, action) {
  const btn = action
    ? `<p style="margin:28px 0"><a href="${esc(action.url)}" style="background:#DC2626;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${esc(action.label)}</a></p>
       <p style="font-size:13px;color:#6b5b5b">Or paste this link into your browser:<br>${esc(action.url)}</p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2B0F0F">
    <h2 style="color:#DC2626;margin-bottom:4px">UniBite</h2><p style="color:#6b5b5b;margin-top:0">Your Campus. Your Cravings. One Click.</p>
    <h3>${esc(title)}</h3>${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${btn}</div>`;
}

async function sendMail({ to, subject, title, paragraphs, action }) {
  const text = [title, '', ...paragraphs, action ? `\n${action.label}: ${action.url}` : ''].join('\n');
  const html = layout(title, paragraphs, action);
  if (!transport) {
    if (IS_PROD) {
      run(`INSERT INTO email_outbox (to_email, subject, text_body, html_body, status, error) VALUES (?, ?, ?, ?, 'failed', 'SMTP not configured')`, to, subject, text, html);
      throw new HttpError(503, 'Email delivery is not configured on this server. Contact the administrator.');
    }
    run(`INSERT INTO email_outbox (to_email, subject, text_body, html_body, status) VALUES (?, ?, ?, ?, 'logged')`, to, subject, text, html);
    console.log(`[mail:dev] to=${to} subject="${subject}"${action ? ` link=${action.url}` : ''}`);
    return { delivered: false };
  }
  try {
    await transport.sendMail({ from: SMTP.from, to, subject, text, html });
    run(`INSERT INTO email_outbox (to_email, subject, text_body, html_body, status) VALUES (?, ?, ?, ?, 'sent')`, to, subject, text, html);
    return { delivered: true };
  } catch (err) {
    run(`INSERT INTO email_outbox (to_email, subject, text_body, html_body, status, error) VALUES (?, ?, ?, ?, 'failed', ?)`, to, subject, text, html, err.message);
    throw new HttpError(502, 'The email could not be sent. Please try again later.');
  }
}

module.exports = { sendMail };
