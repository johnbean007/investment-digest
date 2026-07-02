// Right-click anywhere on the page to leave feedback. Opens a pre-filled
// GitHub issue in a new tab — nothing is submitted until you click
// "Submit new issue" there, so no write credentials are needed here.
(function () {
  const REPO = 'johnbean007/investment-digest';

  let panel = null;
  let capturedSelection = '';
  let capturedLocation = '';

  function describeLocation(el) {
    const card = el.closest && el.closest('.card');
    if (card) {
      const ticker = card.querySelector('.ticker')?.textContent?.trim();
      return `Detail card${ticker ? ': ' + ticker : ''}`;
    }
    const row = el.closest && el.closest('.summary-table tr');
    if (row) {
      const ticker = row.querySelector('.sum-ticker')?.textContent?.trim();
      if (ticker) return `Summary table row: ${ticker}`;
    }
    const recItem = el.closest && el.closest('.rec-item');
    if (recItem) {
      const channel = recItem.querySelector('.rec-channel')?.textContent?.trim() || '';
      const date = recItem.querySelector('.rec-date')?.textContent?.trim() || '';
      return `Recommendation item: ${channel} ${date}`.trim();
    }
    const section = el.closest && el.closest('.summary-section');
    if (section) {
      const heading = section.querySelector('.summary-heading')?.textContent?.trim();
      return `Summary section${heading ? ': ' + heading : ''}`;
    }
    if (el.closest && el.closest('header')) return 'Header / filters';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : '';
    return `Element: <${el.tagName ? el.tagName.toLowerCase() : 'unknown'}${cls}>`;
  }

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  function onOutsideClick(e) {
    if (panel && !panel.contains(e.target)) closePanel();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closePanel();
  }

  function submitFeedback(comment) {
    if (!comment.trim()) return;
    const title = `Feedback: ${capturedLocation}`.slice(0, 120);
    const bodyLines = [
      `**Location:** ${capturedLocation}`,
      `**Page:** ${location.href}`,
    ];
    if (capturedSelection) bodyLines.push('', `> ${capturedSelection}`);
    bodyLines.push('', comment.trim(), '', '---', `_Submitted via on-site feedback, ${new Date().toISOString()}_`);
    const body = bodyLines.join('\n');
    const url = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=feedback`;
    window.open(url, '_blank', 'noopener');
    closePanel();
  }

  function openPanel(x, y, targetEl) {
    closePanel();
    capturedSelection = String(window.getSelection() || '').trim();
    capturedLocation = describeLocation(targetEl);

    panel = document.createElement('div');
    panel.className = 'fb-panel';
    panel.innerHTML = `
      <div class="fb-header">Leave feedback</div>
      <div class="fb-location">${capturedLocation}</div>
      ${capturedSelection ? `<div class="fb-quote">"${capturedSelection.length > 140 ? capturedSelection.slice(0, 140) + '…' : capturedSelection}"</div>` : ''}
      <textarea class="fb-textarea" placeholder="What should change here?" rows="3"></textarea>
      <div class="fb-actions">
        <button class="fb-btn fb-cancel">Cancel</button>
        <button class="fb-btn fb-send">Open issue ↗</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Clamp position within viewport
    const pw = 300, ph = panel.offsetHeight || 200;
    const left = Math.min(x, window.innerWidth - pw - 12);
    const top = Math.min(y, window.innerHeight - ph - 12);
    panel.style.left = `${Math.max(8, left)}px`;
    panel.style.top = `${Math.max(8, top)}px`;

    const textarea = panel.querySelector('.fb-textarea');
    textarea.focus();

    panel.querySelector('.fb-cancel').addEventListener('click', closePanel);
    panel.querySelector('.fb-send').addEventListener('click', () => submitFeedback(textarea.value));
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitFeedback(textarea.value);
    });

    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);
  }

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openPanel(e.clientX, e.clientY, e.target);
  });
})();
