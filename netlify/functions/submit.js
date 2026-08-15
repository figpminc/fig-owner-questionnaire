/**
 * Owner Lead Relay — Netlify Function
 *
 * Receives a JSON submission from the Rental Property Owner Questionnaire form
 * and creates a card on the Aptly "Owner Leads" board.
 *
 * Using the classic v1 (CommonJS `exports.handler`) function format rather than
 * the newer v2 `export default` style — Netlify has had reports of v2 functions
 * intermittently missing environment variables at runtime, which would be bad
 * for a function whose whole job is to use a secret API key. The v1 format is
 * older, more battle-tested, and reads process.env the standard Node.js way.
 *
 * Required environment variables (set in Netlify dashboard: Site settings →
 * Environment variables, or via `netlify env:set`):
 *   APTLY_API_KEY   (mark as a "Secret" value) — the Aptly board API key.
 *   APTLY_BOARD_ID  — emGXMwnLubrAvhKt6
 */

exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const fullName = (payload.fullName || "").trim();
  const email = (payload.email || "").trim();
  const phone = (payload.phone || "").trim();

  if (!fullName || !email || !phone) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing required fields (fullName, email, phone)" })
    };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid email address" }) };
  }

  const apiKey = process.env.APTLY_API_KEY;
  const boardId = process.env.APTLY_BOARD_ID;

  if (!apiKey || !boardId) {
    console.error("Missing APTLY_API_KEY or APTLY_BOARD_ID environment variable");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server misconfigured" }) };
  }

  const normalizedPhone = normalizePhone(phone);
  const answers = payload.answers || {};

  const cardPayload = {
    name: fullName,
    stage: "Contact Made",
    tHsjQDTdS7z7B7ekX: [email],
    description: buildDescriptionHtml(answers, email, phone, payload.submittedAt, payload.sourcePage)
  };

  if (normalizedPhone) {
    cardPayload.zDnH8qPXBsMEztfzZ = [{ number: normalizedPhone, type: "mobile" }];
  }

  let aptlyRes;
  try {
    aptlyRes = await fetch(`https://core-api.getaptly.com/api/board/${boardId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-token": apiKey
      },
      body: JSON.stringify(cardPayload)
    });
  } catch (err) {
    console.error("Network error calling Aptly:", err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Aptly" }) };
  }

  if (!aptlyRes.ok) {
    const errText = await aptlyRes.text().catch(() => "");
    console.error("Aptly API error", aptlyRes.status, errText);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Aptly rejected the card", status: aptlyRes.status })
    };
  }

  const result = await aptlyRes.json().catch(() => ({}));
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, cardId: result.cardId || result._id || null })
  };
};

function normalizePhone(raw) {
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildDescriptionHtml(a, email, phone, submittedAt, sourcePage) {
  const row = (label, val) =>
    `<p><strong>${escapeHtml(label)}</strong><br>${escapeHtml(val) || "&mdash;"}</p>`;

  const q6List = Array.isArray(a.q6_experiencedIssues) && a.q6_experiencedIssues.length
    ? a.q6_experiencedIssues.join(", ")
    : "None selected";

  return [
    `<p><strong>Rental Property Owner Questionnaire submission</strong></p>`,
    row("1. Properties owned & tenure", a.q1_propertiesAndTenure),
    row("2. Why rent vs. sell", a.q2_whyRentVsSell),
    row("3. Main goal for this property", a.q3_mainGoal),
    row("4. What has gone well", a.q4_whatWentWell),
    row("5. Most frustrating/difficult part", a.q5_mostFrustrating),
    row("6. Issues experienced", q6List),
    row("7. Marketing & tenant screening approach", a.q7_marketingAndScreening),
    row("8. Biggest time/stress point after move-in", a.q8_biggestTimeStressor),
    row("9. Plans to buy more rental properties", a.q9_planToBuyMore),
    row("10. One thing they'd change", a.q10_oneThingToChange),
    `<p style="color:#888;font-size:12px;">Submitted ${escapeHtml(submittedAt || "")} via ${escapeHtml(sourcePage || "embedded form")}. Contact: ${escapeHtml(email)} / ${escapeHtml(phone)}</p>`
  ].join("\n");
}
