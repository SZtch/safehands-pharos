// ─── SafeHands Interactive Demo Page (GET /demo) ────────────────────────
// A single self-contained HTML page (no build tooling, no external assets,
// no dependencies) served by the read-only API. It calls the same-origin
// hosted tool gateway (POST /tools/safehands_preflight_check) so visitors
// get REAL decisions from the live deterministic policy engine.
// Zero-custody: the page never asks for keys and never signs anything.
// ────────────────────────────────────────────────────────────────────────

export const DEMO_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SafeHands — live policy demo · Pharos Pacific Mainnet</title>
<meta name="description" content="Paste an agent intent, get a real ALLOW / BLOCK decision from the live SafeHands policy engine on Pharos Pacific Mainnet (1672).">
<style>
  :root{
    --bg0:#0d1117; --bg1:#151c2e; --panel:#161d2f; --line:#232c44;
    --text:#f0f6fc; --muted:#9da7b3; --dim:#6e7781;
    --violet:#7c3aed; --cyan:#0891b2;
    --allow:#16a34a; --block:#dc2626; --confirm:#d97706; --prepare:#0891b2;
  }
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(160deg,var(--bg0),var(--bg1));min-height:100vh;
    color:var(--text);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  .wrap{max-width:880px;margin:0 auto;padding:40px 20px 64px}
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
  h1{font-size:26px;margin:0;letter-spacing:-.02em}
  h1 .shield{background:linear-gradient(90deg,var(--violet),var(--cyan));
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .chip{font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);
    border:1px solid var(--line);border-radius:999px;padding:5px 10px;white-space:nowrap}
  .sub{color:var(--muted);margin:10px 0 0;max-width:64ch}
  .sub b{color:var(--text);font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:28px 0 14px}
  .preset{appearance:none;text-align:left;cursor:pointer;border:1px solid var(--line);
    background:var(--panel);color:var(--text);border-radius:10px;padding:12px 14px;
    transition:border-color .15s,transform .15s}
  .preset:hover{border-color:var(--cyan);transform:translateY(-1px)}
  .preset small{display:block;color:var(--dim);margin-top:3px}
  .preset .tag{float:right;font:11px/1 ui-monospace,monospace;padding:3px 7px;border-radius:6px;margin-left:8px}
  .tag.allow{color:var(--allow);border:1px solid var(--allow)}
  .tag.prepare{color:var(--prepare);border:1px solid var(--prepare)}
  .tag.block{color:var(--block);border:1px solid var(--block)}
  .tag.confirm{color:var(--confirm);border:1px solid var(--confirm)}
  label{display:block;color:var(--muted);font-size:13px;margin:18px 0 6px}
  textarea{width:100%;min-height:150px;resize:vertical;background:#0b101d;color:var(--text);
    border:1px solid var(--line);border-radius:10px;padding:12px 14px;
    font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
  textarea:focus{outline:none;border-color:var(--violet)}
  .run{margin-top:12px;cursor:pointer;border:none;border-radius:10px;padding:12px 22px;
    font-weight:600;font-size:15px;color:#fff;
    background:linear-gradient(90deg,var(--violet),var(--cyan))}
  .run:disabled{opacity:.55;cursor:wait}
  #result{margin-top:26px}
  .card{border-radius:12px;border:1px solid var(--line);background:var(--panel);overflow:hidden}
  .verdict{display:flex;align-items:center;gap:12px;padding:16px 18px;font-size:18px;font-weight:700;
    border-left:6px solid var(--dim)}
  .verdict .lvl{font:12px/1 ui-monospace,monospace;font-weight:400;color:var(--muted)}
  .v-ALLOW{border-left-color:var(--allow);color:var(--allow)}
  .v-BLOCK{border-left-color:var(--block);color:var(--block)}
  .v-REQUIRE_CONFIRMATION{border-left-color:var(--confirm);color:var(--confirm)}
  .v-PREPARE_ONLY{border-left-color:var(--prepare);color:var(--prepare)}
  .v-ERROR{border-left-color:var(--block);color:var(--block)}
  .body{padding:2px 18px 16px;color:var(--muted)}
  .body ul{margin:8px 0;padding-left:20px}
  details{border-top:1px solid var(--line);padding:10px 18px}
  summary{cursor:pointer;color:var(--dim);font-size:13px}
  pre{overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);margin:10px 0 4px}
  footer{margin-top:44px;color:var(--dim);font-size:13px;border-top:1px solid var(--line);padding-top:16px}
  footer a{color:var(--muted)}
  .spin{display:inline-block;width:14px;height:14px;border:2px solid #fff5;border-top-color:#fff;
    border-radius:50%;animation:r .7s linear infinite;vertical-align:-2px;margin-right:8px}
  @keyframes r{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1><span class="shield">🛡 SafeHands</span> live policy demo</h1>
    <span class="chip">Pharos Pacific Mainnet · 1672</span>
    <span class="chip">zero-custody · read-only</span>
  </header>
  <p class="sub">Every button below sends a real agent intent to the <b>live deterministic policy engine</b> running behind this page (<code>POST /tools/safehands_preflight_check</code>). No wallet, no keys, no transaction — this is the check an AI agent runs <b>before</b> it signs anything on Pharos.</p>

  <div class="grid" id="presets"></div>

  <label for="intent">Agent intent (editable JSON)</label>
  <textarea id="intent" spellcheck="false"></textarea>
  <button class="run" id="run">Run preflight</button>

  <div id="result"></div>

  <footer>
    SafeHands never holds keys and never signs for you. ·
    <a href="https://github.com/SZtch/safehands-pharos" rel="noopener">GitHub</a> ·
    <a href="https://www.pharosscan.xyz/address/0x428e02bf85412e7242d991cd6725ec59e8b06c8d" rel="noopener">Registry contract</a> ·
    <a href="https://www.pharosscan.xyz/address/0x71a7a87b3b1ab6d86204cad691bb32fd75b4588c" rel="noopener">Attestation contract</a>
  </footer>
</div>
<script>
(function(){
  "use strict";
  var PRESETS = [
    { name: "Unlimited approval", hint: "agent grants a spender forever", tag: "BLOCK", cls: "block",
      intent: { actionType: "approve_token", chainId: 1672, approvalToken: "USDC",
                spender: "0x000000000000000000000000000000000000dEaD", approvalAmount: "max" } },
    { name: "Wrong chain", hint: "agent targets Ethereum, not Pharos", tag: "BLOCK", cls: "block",
      intent: { actionType: "send_payment", chainId: 1, amount: "0.5", amountUnit: "PROS",
                recipient: "0x0000000000000000000000000000000000000001" } },
    { name: "Safe small payment", hint: "0.001 PROS within policy — safe; sign it yourself", tag: "PREPARE", cls: "prepare",
      intent: { actionType: "send_payment", chainId: 1672, isMainnet: true, amount: "0.001",
                amountUnit: "PROS", recipient: "0x0000000000000000000000000000000000000001" } },
    { name: "Unregistered RWA token", hint: "tokenized asset not in registry", tag: "CONFIRM", cls: "confirm",
      intent: { actionType: "approve_token", chainId: 1672, isMainnet: true, approvalAmount: "25",
                tokenAddress: "0x00000000000000000000000000000000000000aa",
                spender: "0x0000000000000000000000000000000000000001", spenderVerified: false } },
    { name: "Malicious x402 endpoint", hint: "payment to an internal IP", tag: "BLOCK", cls: "block",
      intent: { actionType: "x402_pay_and_fetch", chainId: 1672,
                url: "http://169.254.169.254/latest/meta-data", paymentAmountUsdc: "0.01" } },
    { name: "Oversized settlement", hint: "5 USDC over the x402 policy cap", tag: "BLOCK", cls: "block",
      intent: { actionType: "x402_pay_and_fetch", chainId: 1672, isMainnet: true,
                url: "https://rpc.pharos.xyz/", paymentAmountUsdc: "5" } }
  ];

  var box = document.getElementById("intent");
  var out = document.getElementById("result");
  var run = document.getElementById("run");
  var grid = document.getElementById("presets");

  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.className = "preset";
    b.innerHTML = "<span class='tag " + p.cls + "'>" + p.tag + "</span><strong>" + p.name +
      "</strong><small>" + p.hint + "</small>";
    b.addEventListener("click", function () {
      box.value = JSON.stringify(p.intent, null, 2);
      submit();
    });
    grid.appendChild(b);
  });

  box.value = JSON.stringify(PRESETS[0].intent, null, 2);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function list(title, items) {
    if (!items || !items.length) return "";
    return "<div><b>" + title + "</b><ul>" + items.map(function (r) {
      return "<li>" + esc(r) + "</li>";
    }).join("") + "</ul></div>";
  }

  function render(payload) {
    var html;
    if (payload && payload.success && payload.data) {
      var d = payload.data;
      var decision = d.decision || d.guardianDecision || "UNKNOWN";
      html =
        "<div class='card'>" +
        "<div class='verdict v-" + esc(decision) + "'>" + esc(decision) +
        (d.riskLevel ? " <span class='lvl'>risk: " + esc(d.riskLevel) + "</span>" : "") + "</div>" +
        "<div class='body'>" + list("Why", d.reasons) + list("Required actions", d.requiredActions) +
        (!d.reasons || !d.reasons.length ? "<div>All policy checks passed for this intent.</div>" : "") +
        "</div>" +
        "<details><summary>Raw response</summary><pre>" + esc(JSON.stringify(payload, null, 2)) + "</pre></details>" +
        "</div>";
    } else {
      var err = (payload && payload.error) || {};
      html =
        "<div class='card'>" +
        "<div class='verdict v-ERROR'>" + esc(err.code || "ERROR") + "</div>" +
        "<div class='body'>" + esc(err.message || "Request failed.") + "</div>" +
        "<details><summary>Raw response</summary><pre>" + esc(JSON.stringify(payload, null, 2)) + "</pre></details>" +
        "</div>";
    }
    out.innerHTML = html;
  }

  function submit() {
    var body;
    try { body = JSON.parse(box.value); }
    catch (e) { render({ success: false, error: { code: "INVALID_JSON", message: "The intent is not valid JSON: " + e.message } }); return; }
    run.disabled = true;
    run.innerHTML = "<span class='spin'></span>Checking…";
    fetch("/tools/safehands_preflight_check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (e) { render({ success: false, error: { code: "NETWORK_ERROR", message: String(e) } }); })
      .then(function () { run.disabled = false; run.textContent = "Run preflight"; });
  }

  run.addEventListener("click", submit);
})();
</script>
</body>
</html>
`;
