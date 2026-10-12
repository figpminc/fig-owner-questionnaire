// Owner Questionnaire → Blanket Owner Leads (New). Leads go only to Blanket; Aptly receives
// owners once they sign. Classic v1 (CommonJS) format so process.env is reliable.
//
// Env var (Netlify → Site configuration → Environment variables):
//   BLANKET_LEAD_URL  Blanket Owner Leads website-form URL (secret — keep server-side)
exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

  const fullName = (payload.fullName || "").trim();
  const email = (payload.email || "").trim();
  const phone = (payload.phone || "").trim();

  if (!fullName || !email || !phone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields (fullName, email, phone)" }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid email address" }) };
  }

  const blanketUrl = process.env.BLANKET_LEAD_URL;
  if (!blanketUrl) {
    console.error("Missing BLANKET_LEAD_URL env var");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server misconfigured" }) };
  }

  const parts = fullName.split(/\s+/);
  const firstName = parts.shift();
  const lastName = parts.join(" ");

  const lead = {
    firstName,
    lastName: lastName || undefined,
    email,
    phone: normalizePhone(phone),
    smsConsent: false, // questionnaire has no SMS consent box — email/call only
    message: buildSummary(payload.answers || {}),
    source: "Owner Questionnaire",
    pageUrl: payload.sourcePage || "https://incredible-starship-99ad97.netlify.app/",
    leadTemperature: "warm_inbound"
  };

  try {
    const res = await fetch(blanketUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead)
    });
    const text = await res.text().catch(() => "");
    if (res.status !== 202 && res.status !== 200) {
      console.error("Blanket rejected lead", res.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Lead not accepted" }) };
    }
    console.log("Blanket lead accepted:", text);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error("Blanket fetch error:", err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Blanket" }) };
  }
};

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return raw;
}

function buildSummary(a) {
  const q6 = Array.isArray(a.q6_experiencedIssues) && a.q6_experiencedIssues.length
    ? a.q6_experiencedIssues.join(", ")
    : "None selected";
  const row = (label, val) => `${label}: ${(val == null || val === "") ? "—" : val}`;
  return [
    "Rental Property Owner Questionnaire",
    row("1. Properties owned & tenure", a.q1_propertiesAndTenure),
    row("2. Why rent vs. sell", a.q2_whyRentVsSell),
    row("3. Main goal for this property", a.q3_mainGoal),
    row("4. What has gone well", a.q4_whatWentWell),
    row("5. Most frustrating/difficult part", a.q5_mostFrustrating),
    row("6. Issues experienced", q6),
    row("7. Marketing & tenant screening approach", a.q7_marketingAndScreening),
    row("8. Biggest time/stress point after move-in", a.q8_biggestTimeStressor),
    row("9. Plans to buy more rental properties", a.q9_planToBuyMore),
    row("10. One thing they'd change", a.q10_oneThingToChange)
  ].join("\n");
}
