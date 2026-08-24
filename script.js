/* ===================================================================
   JobGuard AI — client-side heuristic risk engine
   Everything runs in the browser. No text ever leaves the device.
=================================================================== */

/* ---------- Tabs ---------- */
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

/* ---------- File dropzone ---------- */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const dzFileName = document.getElementById('dzFileName');
let uploadedFileName = '';

dropzone.addEventListener('click', () => fileInput.click());
['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});
function handleFile(file) {
  uploadedFileName = file.name;
  dzFileName.textContent = `Attached: ${file.name}`;
}

/* ---------- Risk engine ---------- */
/* Each rule: id, label, weight (points added to risk score), test(text) -> bool */
const RULES = [
  {
    id: 'fee',
    label: 'Asks for money up front (registration, training, security deposit, or "kit" fee)',
    weight: 30,
    test: t => /(registration fee|security deposit|training fee|processing fee|refundable fee|pay.{0,15}(before|to (start|join|confirm))|activation fee|joining fee|kit fee|deposit of|₹\s?\d|rs\.?\s?\d{2,}|nominal fee)/i.test(t)
  },
  {
    id: 'personal-info',
    label: 'Requests sensitive personal or financial details before any hiring step',
    weight: 22,
    test: t => /(aadhaar|pan card|bank details|account number|otp|debit card|credit card|upi pin|cvv)/i.test(t)
  },
  {
    id: 'urgency',
    label: 'Uses high-pressure urgency language',
    weight: 12,
    test: t => /(limited seats|apply immediately|hurry|only \d+ (spots|seats)|urgent(ly)? (hiring|required)|reply within|offer expires|act now|today only|first come)/i.test(t)
  },
  {
    id: 'informal-contact',
    label: 'Pushes contact to WhatsApp/Telegram instead of an official channel',
    weight: 15,
    test: t => /(whatsapp|telegram|\bDM\b|direct message).{0,20}(only|number|link|contact|chat)/i.test(t) || /(contact|message|chat).{0,15}(whatsapp|telegram)/i.test(t)
  },
  {
    id: 'no-interview',
    label: '"No interview needed" / guaranteed hiring language',
    weight: 14,
    test: t => /(no interview|without interview|100% job guarantee|guaranteed (job|placement|selection)|instant (hire|selection|offer))/i.test(t)
  },
  {
    id: 'unrealistic-pay',
    label: 'Pay looks disproportionate for the role or experience described',
    weight: 20,
    test: t => {
      const m = t.match(/₹?\s?(\d{2,3}(?:,\d{3})+|\d{4,6})\s?(?:\/|per)?\s?(day|week|hr|hour)/i);
      if (!m) return false;
      const amount = parseInt(m[1].replace(/,/g, ''), 10);
      const unit = m[2].toLowerCase();
      if (unit.startsWith('day') && amount >= 2000) return true;
      if (unit.startsWith('week') && amount >= 15000) return true;
      if ((unit.startsWith('hr') || unit.startsWith('hour')) && amount >= 500) return true;
      return false;
    }
  },
  {
    id: 'personal-email',
    label: 'Recruiter uses a free/personal email domain instead of a company one',
    weight: 10,
    test: t => /@(gmail|yahoo|hotmail|outlook|rediffmail)\.com/i.test(t)
  },
  {
    id: 'vague-role',
    label: 'Role and responsibilities are vague or generic',
    weight: 8,
    test: t => t.length > 40 && !/(responsib|requirement|qualif|you will|day.?to.?day|role involves)/i.test(t)
  },
  {
    id: 'no-company',
    label: 'No verifiable company name, website, or office address mentioned',
    weight: 12,
    test: t => !/(pvt\.?\s?ltd|private limited|\.com|\.in|www\.|inc\.|llp|corporation|technologies|solutions)/i.test(t)
  },
  {
    id: 'work-from-home-vague',
    label: '"Work from home, earn daily" framing typical of task-based scams',
    weight: 16,
    test: t => /(work from home|earn daily|daily payout|easy (money|income)|part.?time income|earn (up to )?₹)/i.test(t) && /(no experience|no skill|anyone can)/i.test(t)
  }
];

const POSITIVE_SIGNALS = [
  { id: 'formal-process', label: 'Mentions a structured hiring process (interview, assessment, HR round)', test: t => /(interview|assessment|hr round|shortlist|screening call)/i.test(t) },
  { id: 'company-domain', label: 'Uses a company email domain rather than a free one', test: t => /@(?!gmail|yahoo|hotmail|outlook|rediffmail)[a-z0-9-]+\.(com|in|co|org)/i.test(t) },
  { id: 'clear-scope', label: 'Describes clear responsibilities and requirements', test: t => /(responsib|requirement|qualif|you will|role involves)/i.test(t) }
];

function analyze(text, url) {
  const combined = `${text}\n${url || ''}`;
  let score = 0;
  const flags = [];
  const clears = [];

  RULES.forEach(rule => {
    if (rule.test(combined)) {
      score += rule.weight;
      flags.push({ label: rule.label, type: 'flag' });
    }
  });

  POSITIVE_SIGNALS.forEach(sig => {
    if (sig.test(combined)) {
      score = Math.max(0, score - 6);
      clears.push({ label: sig.label, type: 'clear' });
    }
  });

  // If almost nothing to go on, keep the score cautious-middle rather than confidently green.
  if (combined.trim().length < 25) {
    score = Math.max(score, 35);
    flags.push({ label: 'Very little text to analyze — treat this reading as low-confidence', type: 'caution' });
  }

  score = Math.min(100, score);

  let verdict, verdictClass, recommendation;
  if (score >= 55) {
    verdict = 'HIGH RISK';
    verdictClass = 'red';
    recommendation = 'Multiple hallmarks of a job scam are present. Do not pay any fee, do not share ID or bank details, and verify the company independently before responding — through a phone number or website you find yourself, not one given in the message.';
  } else if (score >= 25) {
    verdict = 'CAUTION';
    verdictClass = 'amber';
    recommendation = 'Some red flags showed up. Ask for the offer in writing on a company letterhead, verify the company on LinkedIn and its official site, and never pay anything before a formal offer letter and signed contract.';
  } else {
    verdict = 'LIKELY GENUINE';
    verdictClass = 'green';
    recommendation = 'No major red flags detected. Still worth a quick independent check — confirm the recruiter\'s identity and the company\'s official careers page before sharing personal documents.';
  }

  const items = [...flags, ...clears];
  if (items.length === 0) {
    items.push({ label: 'No specific patterns matched either way — read is based on limited signal', type: 'caution' });
  }

  return { score, verdict, verdictClass, recommendation, items };
}

/* ---------- Wire up the analyzer ---------- */
const analyzeBtn = document.getElementById('analyzeBtn');
const verdictEmpty = document.getElementById('verdictEmpty');
const verdictResult = document.getElementById('verdictResult');
const resultCaseId = document.getElementById('resultCaseId');
const resultDate = document.getElementById('resultDate');
const resultStamp = document.getElementById('resultStamp');
const scoreNum = document.getElementById('scoreNum');
const scoreBarFill = document.getElementById('scoreBarFill');
const evidenceList = document.getElementById('evidenceList');
const recommendText = document.getElementById('recommendText');
const saveCaseBtn = document.getElementById('saveCaseBtn');

let currentResult = null;
let currentInputSummary = '';

function randomCaseId() {
  return String(Math.floor(1000 + Math.random() * 9000)) + String(Math.floor(10 + Math.random() * 90));
}

analyzeBtn.addEventListener('click', () => {
  const text = document.getElementById('jobText').value.trim();
  const url = document.getElementById('jobUrl').value.trim();
  const source = text || uploadedFileName || url;

  if (!source) {
    document.getElementById('jobText').focus();
    document.getElementById('jobText').placeholder = 'Paste something here first — even a couple of sentences helps.';
    return;
  }

  const result = analyze(text, url);
  currentResult = result;
  currentInputSummary = (text || uploadedFileName || url).slice(0, 80);

  renderResult(result);
});

function renderResult(result) {
  verdictEmpty.hidden = true;
  verdictResult.hidden = false;

  resultCaseId.textContent = randomCaseId();
  resultDate.textContent = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  resultStamp.className = `stamp stamp-${result.verdictClass}`;
  resultStamp.textContent = result.verdict;
  resultStamp.style.animation = 'none';
  void resultStamp.offsetWidth;
  resultStamp.style.animation = 'stamp-in 0.45s cubic-bezier(.2,1.6,.4,1) both';

  scoreNum.textContent = result.score;
  scoreNum.style.color = result.verdictClass === 'red' ? 'var(--red)' : result.verdictClass === 'amber' ? 'var(--amber-dim)' : 'var(--green)';
  scoreBarFill.style.width = result.score + '%';
  scoreBarFill.style.background = result.verdictClass === 'red' ? 'var(--red)' : result.verdictClass === 'amber' ? 'var(--amber-dim)' : 'var(--green)';

  evidenceList.innerHTML = '';
  result.items.forEach(item => {
    const el = document.createElement('div');
    const cls = item.type === 'flag' ? 'flag' : item.type === 'clear' ? 'clear' : 'caution';
    const mark = item.type === 'flag' ? '✕' : item.type === 'clear' ? '✓' : '!';
    el.className = `ev-item ${cls}`;
    el.innerHTML = `<span class="ev-mark">${mark}</span><span>${item.label}</span>`;
    evidenceList.appendChild(el);
  });

  recommendText.textContent = result.recommendation;
  verdictResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------- Case log (saved to this browser only) ---------- */
const logList = document.getElementById('logList');
const logEmpty = document.getElementById('logEmpty');
const STORAGE_KEY = 'jobguard_case_log';

function getLog() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function setLog(log) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

saveCaseBtn.addEventListener('click', () => {
  if (!currentResult) return;
  const log = getLog();
  log.unshift({
    id: Date.now(),
    title: currentInputSummary || 'Untitled posting',
    score: currentResult.score,
    verdict: currentResult.verdict,
    verdictClass: currentResult.verdictClass,
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  });
  setLog(log.slice(0, 25));
  renderLog();
  saveCaseBtn.textContent = 'Saved ✓';
  setTimeout(() => { saveCaseBtn.textContent = 'Save to case log'; }, 1500);
});

function renderLog() {
  const log = getLog();
  logList.querySelectorAll('.log-item').forEach(el => el.remove());
  logEmpty.hidden = log.length > 0;

  log.forEach(entry => {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `
      <span class="log-stamp-mini ${entry.verdictClass}">${entry.verdict}</span>
      <div class="log-item-body">
        <div class="log-item-title">${escapeHtml(entry.title)}</div>
        <div class="log-item-meta">${entry.date}</div>
      </div>
      <div class="log-item-score">${entry.score}</div>
      <button class="log-item-del" title="Remove" data-id="${entry.id}">✕</button>
    `;
    logList.appendChild(el);
  });

  logList.querySelectorAll('.log-item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      setLog(getLog().filter(e => e.id !== id));
      renderLog();
    });
  });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
renderLog();

/* ---------- Hero demo case id ---------- */
document.getElementById('demoCaseId').textContent = randomCaseId();
