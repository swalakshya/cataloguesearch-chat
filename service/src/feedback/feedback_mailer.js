import { log } from "../utils/log.js";

const BREVO_API_URL = "https://api.sendinblue.com/v3/smtp/email";

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendNotHelpfulEmail(record) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    log.warn("feedback_email_skipped", { reason: "BREVO_API_KEY_not_configured", id: record.id });
    return;
  }

  const fromEmail = process.env.FEEDBACK_FROM_EMAIL || "noreply@swalakshya.me";
  const toEmail = process.env.FEEDBACK_TO_EMAIL || "contact@swalakshya.me";

  const contact = [record.userName, record.userEmail || record.userPhone]
    .filter(Boolean)
    .join(" — ");

  const answerPreview = (record.answer || "").length > 500
    ? record.answer.slice(0, 500) + "…"
    : record.answer;

  const submittedAt = new Date(record.createdAt).toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const separator = "─".repeat(40);

  const textBody = [
    `Feedback: ${record.message}`,
    "",
    `From:     ${contact}`,
    `Submitted: ${submittedAt}`,
    "",
    separator,
    "",
    `Question: ${record.question}`,
    "",
    `Answer:`,
    answerPreview,
    "",
    separator,
    "",
    `Feedback ID: ${record.id}`,
    `Request ID:  ${record.requestId || "n/a"}`,
  ].join("\n");

  const htmlBody = [
    `<p><strong>Feedback:</strong> ${esc(record.message)}</p>`,
    `<p><strong>From:</strong> ${esc(contact)}<br><strong>Submitted:</strong> ${esc(submittedAt)}</p>`,
    `<hr>`,
    `<p><strong>Question:</strong> ${esc(record.question)}</p>`,
    `<p><strong>Answer:</strong><br>${esc(answerPreview).replace(/\n/g, "<br>")}</p>`,
    `<hr>`,
    `<p style="color:#888;font-size:12px;">`,
    `<strong>Feedback ID:</strong> ${esc(record.id)}<br>`,
    `<strong>Request ID:</strong> ${esc(record.requestId || "n/a")}`,
    `</p>`,
  ].join("\n");

  const payload = {
    sender: {
      name: "Swalakshya AIBot",
      email: fromEmail,
    },
    to: [{ email: toEmail }],
    subject: "[AIBot] Feedback",
    textContent: textBody,
    htmlContent: htmlBody,
  };

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 201) {
      log.info("feedback_email_sent", { id: record.id, requestId: record.requestId ?? null });
    } else {
      const text = await response.text().catch(() => "");
      log.error("feedback_email_failed", {
        id: record.id,
        requestId: record.requestId ?? null,
        status: response.status,
        message: text,
      });
    }
  } catch (err) {
    log.error("feedback_email_failed", {
      id: record.id,
      requestId: record.requestId ?? null,
      message: err?.message || String(err),
    });
  }
}
