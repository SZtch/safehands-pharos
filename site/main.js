// SafeHands landing page behaviour: theme toggle, the specimen inspector,
// and the integration tabs. No dependencies and no build step.
// The inspector samples are illustrative; the CLI output shown in the tabs is
// real, produced by the command printed above it.

(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  var themeTimer = null;
  document.getElementById("theme").addEventListener("click", function () {
    var cur = root.getAttribute("data-theme");
    if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    if (reduce) { root.setAttribute("data-theme", next); return; }
    // Turn the cross-fade on, force the browser to commit it as the current
    // state (the reflow), THEN flip. Without that flush the colour change and
    // the transition land in one tick and the switch snaps. Drop the class once
    // the fade is done so nothing else keeps carrying the transition.
    root.classList.add("theming");
    root.getBoundingClientRect();
    root.setAttribute("data-theme", next);
    if (themeTimer) clearTimeout(themeTimer);
    themeTimer = setTimeout(function () { root.classList.remove("theming"); }, 450);
  });

  // Hamburger: a plain button toggling the nav panel, with aria-expanded kept
  // truthful. It closes when a link is chosen, on Escape, and when the viewport
  // grows back to the desktop nav so state never leaks between layouts.
  var burger = document.getElementById("burger");
  var nav = document.getElementById("nav");
  function setMenu(open) {
    nav.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  burger.addEventListener("click", function () {
    setMenu(burger.getAttribute("aria-expanded") !== "true");
  });
  nav.addEventListener("click", function (e) { if (e.target.tagName === "A") setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && burger.getAttribute("aria-expanded") === "true") { setMenu(false); burger.focus(); }
  });
  matchMedia("(min-width: 841px)").addEventListener("change", function (e) { if (e.matches) setMenu(false); });

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
  var elWord = document.getElementById("word");
  var elScore = document.getElementById("score");
  var elFill = document.getElementById("fill");
  var elNeedle = document.getElementById("needle");
  var elFind = document.getElementById("findings");
  var elAct = document.getElementById("act");
  var elSr = document.getElementById("sr");
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
    // The verdict colour is the page's only colour, so it is set on the root:
    // the gauge, the hero highlight, the section marks and the ground tint all
    // read from it. Land on a blocked approval and the page is red; ask about a
    // verified swap and it turns green. The colour is the product working.
    root.style.setProperty("--vc", getComputedStyle(root).getPropertyValue("--" + s.v).trim());
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
    elAct.innerHTML = s.act;
    elSr.textContent =
      s.word + ". Risk score " + s.score + " out of 100, block threshold 70. " + s.findings[0];
    function set() {
      elFill.style.width = "calc(" + s.score + "% - 2px)";
      elNeedle.style.left = s.score + "%";
    }
    if (reduce) { set(); return; }
    elFill.style.width = "0%";
    requestAnimationFrame(function () { requestAnimationFrame(set); });
  }

  var inst = document.getElementById("demo");
  var order = ["block", "allow", "warn"];
  var cyc = 0, hovered = false, userTook = false, autoTimer = null;

  function press(key) {
    pills.forEach(function (q) { q.setAttribute("aria-pressed", q.dataset.k === key ? "true" : "false"); });
    paint(key);
  }

  // The inspector steps through the specimens on its own, so the instrument is
  // visibly live, then hands control over the moment one is chosen by hand. It
  // pauses while the pointer is on it (a reader is never interrupted mid-finding)
  // and while the tab is hidden, and never runs when reduced motion is asked for.
  function nextAuto() {
    if (reduce || userTook) return;
    autoTimer = setTimeout(function () {
      if (userTook) return;
      if (document.hidden || hovered) { nextAuto(); return; }
      cyc = (cyc + 1) % order.length;
      press(order[cyc]);
      nextAuto();
    }, 4200);
  }
  function stopAuto() {
    userTook = true;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (inst) inst.classList.add("interacted");
  }
  if (inst) {
    inst.addEventListener("mouseenter", function () { hovered = true; });
    inst.addEventListener("mouseleave", function () { hovered = false; });
  }

  pills.forEach(function (p) {
    p.addEventListener("click", function () {
      stopAuto();
      cyc = order.indexOf(p.dataset.k);
      press(p.dataset.k);
    });
  });

  elScore.textContent = "0";
  if (reduce) {
    press("block");
  } else {
    setTimeout(function () { press("block"); cyc = 0; nextAuto(); }, 260);
  }

  // The Run card's install command copies to the clipboard. It tries the async
  // Clipboard API, falls back to execCommand, and if a sandboxed context blocks
  // both (some embedded previews do), it selects the visible line so a manual
  // copy still works. The button reports which path was taken.
  var runCopy = document.getElementById("runcopy");
  var runCode = document.querySelector(".run-cmd code");
  if (runCopy && runCode) {
    var runReset = null;
    var RUN_CMD = runCode.textContent.trim();
    var runFlash = function (ok) {
      runCopy.textContent = ok ? "Copied" : "Ctrl+C";
      runCopy.classList.toggle("done", ok);
      if (runReset) clearTimeout(runReset);
      runReset = setTimeout(function () { runCopy.textContent = "Copy"; runCopy.classList.remove("done"); }, 1800);
    };
    var runSelect = function () {
      var sel = window.getSelection();
      if (!sel) return;
      var range = document.createRange();
      range.selectNodeContents(runCode);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    runCopy.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(RUN_CMD).then(
          function () { runFlash(true); },
          function () { runSelect(); runFlash(false); }
        );
        return;
      }
      var ok = false;
      try {
        var ta = document.createElement("textarea");
        ta.value = RUN_CMD; ta.style.position = "fixed"; ta.style.top = "-9999px"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) { /* copy blocked in this context; ok stays false */ }
      if (!ok) runSelect();
      runFlash(ok);
    });
  }

  // Entrance reveals and the LED count-up. All are added by script, never in
  // the markup, so with JS off or motion reduced the page stays fully visible.
  if (!reduce && "IntersectionObserver" in window) {
    // Play each animation every time its target is scrolled to, not just once:
    // fire when it is well into view, and re-arm only once it has fully left, so
    // the boundary never thrashes.
    function onScrollInOut(el, play, reset) {
      var armed = true;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.intersectionRatio >= 0.2 && armed) { armed = false; play(el); }
          else if (e.intersectionRatio === 0 && !armed) { armed = true; reset(el); }
        });
      }, { threshold: [0, 0.2] }).observe(el);
    }

    // Section reveals: each card rises and fades in, staggered within its group,
    // and drops back out once the group has left so it replays on return.
    [".figures .fig", "#realfi .rfi-row", "#catches .spec", "#trust .row", "#trust .nl > div", "#who .path"].forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el, i) {
        el.classList.add("reveal");
        el.style.transitionDelay = (i * 70) + "ms";
        onScrollInOut(el,
          function () { el.classList.add("in"); },
          function () { el.classList.remove("in"); });
      });
    });

    // How it works reads as a pipeline: when the strip comes into view a green
    // signal sweeps across it, the four steps light up in order, and the two
    // steps that are ours (the green ones) pulse as they activate. Scroll away
    // and back and the whole sequence plays again.
    var seq = document.querySelector("#how .seq");
    if (seq) {
      var howSteps = Array.prototype.slice.call(seq.querySelectorAll(".st"));
      howSteps.forEach(function (el) { el.classList.add("reveal"); });
      var howTimers = [];
      onScrollInOut(seq,
        function () {
          seq.classList.add("flow");
          howSteps.forEach(function (el, i) {
            howTimers.push(setTimeout(function () {
              el.classList.add("in");
              if (el.classList.contains("key")) {
                el.classList.remove("lit");
                void el.offsetWidth;               // restart the pulse cleanly
                el.classList.add("lit");
              }
            }, i * 160));
          });
        },
        function () {
          howTimers.forEach(clearTimeout);
          howTimers = [];
          seq.classList.remove("flow");
          howSteps.forEach(function (el) { el.classList.remove("in", "lit"); });
        });
    }

    // The big figures roll up from zero whenever they scroll into view, and
    // reset to zero on the way out so the count replays next time. The green 0
    // keeps its <em> styling, so it is left untouched.
    Array.prototype.forEach.call(document.querySelectorAll(".figures .fig b"), function (b) {
      if (b.querySelector("em")) return;
      var target = parseInt(b.textContent, 10);
      if (isNaN(target)) return;
      b.setAttribute("data-to", target);
      b.textContent = "0";
      var raf = null;
      onScrollInOut(b,
        function () {
          if (raf) cancelAnimationFrame(raf);
          var t0 = performance.now(), ms = 900;
          (function step(now) {
            var k = Math.min(1, (now - t0) / ms);
            b.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
            if (k < 1) raf = requestAnimationFrame(step);
          })(t0);
        },
        function () { if (raf) cancelAnimationFrame(raf); b.textContent = "0"; });
    });
  }
})();
