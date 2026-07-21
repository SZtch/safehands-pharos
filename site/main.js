// SafeHands landing page behaviour: theme toggle, the specimen inspector,
// and the integration tabs. No dependencies and no build step.
// The inspector samples are illustrative; the CLI output shown in the tabs is
// real, produced by the command printed above it.

(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.getElementById("theme").addEventListener("click", function () {
    var cur = root.getAttribute("data-theme");
    if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
  });

  /* Tick strip, drawn rather than hand-written: majors every 10, labels every 20. */
  var ticks = document.getElementById("ticks");
  for (var v = 0; v <= 100; v += 5) {
    var t = document.createElement("span");
    t.className = "t";
    t.style.left = v + "%";
    if (v % 10 === 0) t.className = "t maj";
    ticks.appendChild(t);
    if (v % 20 === 0) {
      var lbl = document.createElement("span");
      lbl.className = "n";
      lbl.style.left = v + "%";
      lbl.textContent = v;
      lbl.setAttribute("data-v", v);
      ticks.appendChild(lbl);
    }
  }

  var SAMPLES = {
    block: {
      req: 'method   <b>approve(spender, amount)</b>\n' +
           'spender  <b>0x4d\u2026c1b2</b>  <u>unverified router</u>\n' +
           'amount   <u>UNLIMITED (2^256-1)</u>',
      v: "block", word: "BLOCK", score: 90,
      findings: [
        "Unlimited approval to an unverified spender. If that contract is compromised, it can move the entire balance, indefinitely.",
        "The spender is not in the first-party registry. Recognition would need verified on-chain evidence, which is absent."
      ],
      act: "<b>Do not sign.</b> Offer a bounded, exact-amount approval to a registry-verified contract instead, then re-check it."
    },
    allow: {
      req: 'action   <b>swap 10 USDC to PROS</b>\n' +
           'venue    <b>OKX router</b>  registry-verified\n' +
           'price    <b>live Chainlink</b>  within range',
      v: "allow", word: "ALLOW", score: 5,
      findings: [
        "Router and token-approve contract are registry-verified on chain 1672, by code hash.",
        "Exact-amount approval and a live price inside the expected band. Nothing unbounded."
      ],
      act: "<b>Safe to sign.</b> The verdict is bound to these exact bytes for 10 minutes; sign different bytes and it no longer applies."
    },
    warn: {
      req: 'action   <b>transfer 0.2 PROS</b>\n' +
           'to       <b>0xa1\u2026f30c</b>  <u>fresh wallet</u>\n' +
           'history  <u>none on chain 1672</u>',
      v: "warn", word: "WARN", score: 45,
      findings: [
        "The recipient is a brand-new wallet with no on-chain history. Could be correct, could be a typo or an address-poisoning lookalike.",
        "The amount is small relative to the wallet's holdings, so exposure is limited."
      ],
      act: "<b>Confirm the recipient</b> through a second channel before signing. Not blocked, but worth a human glance."
    }
  };

  var elReq = document.getElementById("req");
  var elGauge = document.getElementById("gauge");
  var elWord = document.getElementById("word");
  var elScore = document.getElementById("score");
  var elFill = document.getElementById("fill");
  var elNeedle = document.getElementById("needle");
  var elFind = document.getElementById("findings");
  var elAct = document.getElementById("act");
  var pills = Array.prototype.slice.call(document.querySelectorAll(".pill"));

  /* The score travels with the needle rather than snapping to its final value. */
  var counter = null;
  function countTo(target) {
    if (counter) cancelAnimationFrame(counter);
    if (reduce) { elScore.textContent = target; return; }
    var from = parseInt(elScore.textContent, 10) || 0;
    var t0 = performance.now(), ms = 620;
    (function step(now) {
      var k = Math.min(1, (now - t0) / ms);
      var eased = 1 - Math.pow(1 - k, 3);
      elScore.textContent = Math.round(from + (target - from) * eased);
      if (k < 1) counter = requestAnimationFrame(step);
    })(t0);
  }

  function paint(key) {
    var s = SAMPLES[key];
    elGauge.style.setProperty("--vc", "var(--" + s.v + ")");
    elReq.innerHTML = s.req;
    elWord.textContent = s.word;
    elFind.innerHTML = "";
    s.findings.forEach(function (f, i) {
      var li = document.createElement("li");
      li.textContent = f;
      if (!reduce) {
        li.className = "arriving";
        setTimeout(function () { li.className = "arriving settled"; }, 260 + i * 90);
      }
      elFind.appendChild(li);
    });
    countTo(s.score);
    document.getElementById("sr").textContent =
      s.word + ". Risk score " + s.score + " out of 100, block threshold 70. " + s.findings[0];
    function set() {
      elFill.style.width = "calc(" + s.score + "% - 2px)";
      elNeedle.style.left = s.score + "%";
    }
    if (reduce) { set(); return; }
    elFill.style.width = "0%";
    requestAnimationFrame(function () { requestAnimationFrame(set); });
  }

  pills.forEach(function (p) {
    p.addEventListener("click", function () {
      pills.forEach(function (q) { q.setAttribute("aria-pressed", q === p ? "true" : "false"); });
      paint(p.dataset.k);
    });
  });
  elScore.textContent = "0";
  if (reduce) paint("block");
  else setTimeout(function () { paint("block"); }, 260);

  var SNIPPETS = {
    skill:
'<span class="c"># the whole thing, as an agent skill</span>\n' +
'npx skills add <span class="m">SZtch/safehands-pharos</span>\n\n' +
'<span class="c"># then ask your agent in its own words:</span>\n' +
'<span class="s">"Run a SafeHands preflight before I sign this approval."</span>',
    mcp:
'<span class="c">// claude_desktop_config.json, or any MCP client</span>\n' +
'{\n' +
'  <span class="k">"mcpServers"</span>: {\n' +
'    <span class="k">"safehands"</span>: {\n' +
'      <span class="k">"command"</span>: <span class="s">"npx"</span>,\n' +
'      <span class="k">"args"</span>: [<span class="s">"-y"</span>, <span class="s">"github:SZtch/safehands-pharos"</span>]\n' +
'    }\n' +
'  }\n' +
'}\n\n' +
'<span class="c">// read-only by default: no key, no wallet, no setup</span>',
    sdk:
'<span class="c">// tightest: the deterministic engine, inside your own code</span>\n' +
'<span class="k">import</span> { evaluateActionPolicy } <span class="k">from</span> <span class="s">"safehands-pharos"</span>;\n\n' +
'<span class="k">const</span> verdict = <span class="m">evaluateActionPolicy</span>(action);\n' +
'<span class="k">if</span> (!verdict.safeToExecute) <span class="k">return</span>;   <span class="x">// do not auto-sign</span>',
    cli:
'<span class="c"># one verdict, straight from the terminal</span>\n' +
'npx safehands-pharos skill <span class="m">safehands_preflight_check</span> \\\n' +
'  <span class="s">\'{"actionType":"approve_token","chainId":1672,\n' +
'     "approvalToken":"USDC","approvalAmount":"max",\n' +
'     "spender":"0x0000\u20260000dEaD"}\'</span>\n\n' +
'<span class="c"># -> { "success": true, "data": { "decision": "BLOCK",</span>\n' +
'<span class="c">#      "reasons": ["Unlimited approval requested."] } }</span>'
  };
  var elCode = document.getElementById("code");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (q) { q.setAttribute("aria-selected", q === t ? "true" : "false"); });
      elCode.innerHTML = "<pre>" + SNIPPETS[t.dataset.tab] + "</pre>";
    });
  });
  elCode.innerHTML = "<pre>" + SNIPPETS.skill + "</pre>";
})();
