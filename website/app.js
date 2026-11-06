(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const topics = [
    { id: 'space', title: 'Make space', summary: 'Give your attention a place to land.', body: 'Choose one small window in your day and protect it. Twenty quiet minutes can be enough. Put the phone away, close the extra tabs, and leave one thing in front of you.', quote: 'Make the beginning easy to find.', follow: 'Leave a small invitation for your next session: an open notebook, an unfinished sketch, or one question. You return to a starting point instead of a blank page.' },
    { id: 'small', title: 'Start small', summary: 'Make the first step smaller than the resistance.', body: 'Pick an action you can finish in ten minutes. Write one paragraph. Sketch one shape. Record one melody. A small beginning gives you something real to build on.', quote: 'Follow the next interesting question.', follow: 'Ask what you are curious about right now, then make a tiny experiment around it. You can change direction once you have something to react to.' },
    { id: 'momentum', title: 'Keep momentum', summary: 'Leave a thread you can pick up tomorrow.', body: 'At the end of a session, write down what you tried and what you want to try next. A short note makes returning easier, even after a few days away.', quote: 'Stop with a next step in mind.', follow: 'Before you close the notebook, write a specific next move: try a different opening, change the rhythm, or simplify one shape. Keep it small enough to begin immediately.' }
  ];
  let chatState = 'overview';
  const visited = new Set(['overview']);
  const replies = new Set();
  const scene = $('scene-stage');
  const sceneButton = (label, action) => `<button class="scene-action" data-scene="${action}">${label}</button>`;
  function showChat(next) {
    chatState = next;
    visited.add(next);
    const topic = topics.find((item) => item.id === next);
    $('demo-breadcrumb').innerHTML = next === 'overview' ? 'Creative work' : '<button data-scene="overview">Creative work</button><span>/</span>' + (topic ? `<button data-scene="branches">Three paths</button><span>/</span>${topic.title}` : next === 'synthesis' ? 'Putting it together' : 'Three paths');
    if (next === 'overview') {
      scene.innerHTML = `<div class="scene-content"><div class="root-card"><div class="node-kicker">01 · THE STARTING POINT</div><h3>How can I make more time<br>for creative work?</h3><p>Give yourself a little space, start with something small, and leave a way back in.</p><p>There are three ideas here. Each is a path you can follow.</p>${sceneButton('Explore the ideas ↓', 'branches')}</div></div>`;
    } else if (next === 'branches') {
      scene.innerHTML = `<div class="scene-content"><div class="branch-root">Make more time for creative work</div><div class="branch-grid">${topics.map((item, index) => `<button class="branch-card" data-scene="${item.id}"><span>0${index + 1} ↗</span><h3>${item.title}</h3><p>${item.summary}</p></button>`).join('')}</div><div class="branch-footer">${sceneButton('Bring these ideas together ↘', 'synthesis')}</div></div>`;
    } else if (topic) {
      scene.innerHTML = `<div class="scene-content topic-detail"><div class="node-kicker">A CLOSER LOOK</div><h3>${topic.title}</h3><p>${topic.body}</p><p class="quote">${topic.quote}</p>${replies.has(topic.id) ? `<div class="inline-reply"><small>You · How would I do that?</small><p>${topic.follow}</p></div>` : `<button class="scene-action" data-reply="${topic.id}">Ask about this passage ↗</button>`}<div>${sceneButton('← Back to the three ideas', 'branches')}</div></div>`;
    } else {
      scene.innerHTML = `<div class="scene-content"><div class="root-card"><div class="node-kicker">THREE PATHS · ONE NEXT STEP</div><h3>A small practice you can return to.</h3><p>Protect twenty minutes. Begin with one small experiment. Leave a note for tomorrow.</p><p>These ideas come together here. Their individual paths are still there whenever you need them.</p>${sceneButton('← Explore the paths again', 'branches')}</div></div>`;
    }
    $('composer-label').textContent = topic ? `Asking about ${topic.title.toLowerCase()}` : next === 'synthesis' ? 'Bringing the ideas together' : 'Creative work';
    $('demo-prompt').textContent = topic ? 'Go deeper without losing the bigger picture.' : next === 'branches' ? 'Choose a path. You can always come back.' : next === 'synthesis' ? 'What would this look like in my day?' : 'How can I make more time for creative work?';
    $('chat-step').textContent = `${next === 'overview' ? '01' : next === 'branches' ? '02' : topic ? '03' : '04'} / 04`;
    $('chat-caption').textContent = topic ? 'Ask beside a passage. Return to exactly where you were.' : next === 'branches' ? 'One answer can open into several ideas. Choose any topic.' : next === 'synthesis' ? 'Separate ideas can meet again, with their connections preserved.' : 'Start with an answer. Follow the part that interests you.';
    const entries = [{ id: 'overview', title: 'You', summary: 'How can I make more time for creative work?' }];
    if (visited.has('branches')) entries.push(...topics);
    if (visited.has('synthesis')) entries.push({ id: 'synthesis', title: 'Putting it together', summary: 'A small practice you can return to.' });
    $('demo-transcript').innerHTML = entries.map((item) => `<button class="transcript-entry${item.id === next ? ' active' : ''}" data-scene="${item.id}"><strong>${item.title}</strong>${item.summary}</button>`).join('');
    $('turn-count').textContent = entries.length;
    const nodes = [{ id: 'overview', x: 100, y: 18, title: 'Creative work' }];
    if (visited.has('branches')) topics.forEach((item, i) => nodes.push({ id: item.id, x: 35 + 65 * i, y: 65, title: item.title }));
    if (visited.has('synthesis')) nodes.push({ id: 'synthesis', x: 100, y: 110, title: 'Putting it together' });
    $('demo-map').innerHTML = `<title>Conversation map. Select a topic to open it.</title>${nodes.filter((n) => n.id !== 'overview' && n.id !== 'synthesis').map((n) => `<line x1="100" y1="18" x2="${n.x}" y2="${n.y}"/>${visited.has('synthesis') ? `<line x1="${n.x}" y1="${n.y}" x2="100" y2="110"/>` : ''}`).join('')}${nodes.map((n) => `<g role="button" tabindex="0" aria-label="Open ${n.title}" data-scene="${n.id}" class="${next === n.id ? 'active' : ''}"><title>${n.title}</title><circle cx="${n.x}" cy="${n.y}" r="4"/><circle cx="${n.x}" cy="${n.y}" r="12" fill="transparent" style="fill:transparent"/></g>`).join('')}`;
  }
  document.addEventListener('click', (event) => {
    const jump = event.target.closest('[data-scene]');
    if (jump) showChat(jump.dataset.scene);
    const reply = event.target.closest('[data-reply]');
    if (reply) { replies.add(reply.dataset.reply); showChat(reply.dataset.reply); }
  });
  $('demo-map').addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-scene]');
    if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); showChat(target.dataset.scene); }
  });
  $('reset-chat').addEventListener('click', () => { visited.clear(); replies.clear(); showChat('overview'); });
  showChat('overview');

  let helpMode = 'guide';
  let responseTimer;
  let answered = false;
  const guideQuestion = 'Where do I create a new project?';
  const translateQuestion = 'Translate the sentence about curiosity.';
  function positionAnnotation() {
    if (!answered) return;
    const target = helpMode === 'guide' ? document.querySelector('.mock-new-button') : $('translation-source');
    const screen = $('mock-screen').getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const pointer = $('screen-pointer');
    Object.assign(pointer.style, { left: `${rect.left - screen.left - 4}px`, top: `${rect.top - screen.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    if (helpMode === 'translate') {
      const callout = $('translation-callout');
      const left = Math.min(Math.max(12, rect.left - screen.left), screen.width - callout.offsetWidth - 12);
      Object.assign(callout.style, { left: `${left}px`, top: `${rect.bottom - screen.top + 13}px` });
    }
  }
  function closeHelp() {
    clearTimeout(responseTimer);
    answered = false;
    $('help-overlay').hidden = true;
    $('help-answer').hidden = true;
    $('screen-pointer').hidden = true;
    $('translation-callout').hidden = true;
    $('invoke-help').hidden = false;
    $('help-orb').classList.remove('working');
    $('send-help').disabled = false;
  }
  function openHelp() {
    $('invoke-help').hidden = true;
    $('help-overlay').hidden = false;
    $('help-state').textContent = 'metafor help';
    $('help-question').textContent = helpMode === 'guide' ? guideQuestion : translateQuestion;
    $('help-caption').textContent = 'A small bar appears over your work. Send the example question.';
    $('send-help').focus({ preventScroll: true });
  }
  $('invoke-help').addEventListener('click', openHelp);
  $('close-help').addEventListener('click', () => { closeHelp(); $('invoke-help').focus({ preventScroll: true }); });
  $('dismiss-answer').addEventListener('click', () => { $('help-answer').hidden = true; });
  $('send-help').addEventListener('click', () => {
    if ($('send-help').disabled) return;
    $('send-help').disabled = true;
    $('help-state').textContent = 'Looking at the page…';
    $('help-orb').classList.add('working');
    responseTimer = setTimeout(() => {
      answered = true;
      $('help-orb').classList.remove('working');
      $('help-state').textContent = 'Ready for your next question';
      $('help-answer-copy').textContent = helpMode === 'guide' ? 'Use New project at the top right. It starts a fresh space for your next idea.' : 'The translation appears beside the original sentence, so you can keep reading in place.';
      $('help-answer').hidden = helpMode === 'translate';
      $('screen-pointer').hidden = false;
      $('pointer-label').hidden = helpMode === 'translate';
      $('translation-callout').hidden = helpMode !== 'translate';
      $('help-caption').textContent = helpMode === 'guide' ? 'The answer points to the original page. Your work stays in view.' : 'A translation beside its source. No switching windows or copying text.';
      $('send-help').disabled = false;
      positionAnnotation();
    }, 700);
  });
  document.querySelectorAll('[data-help-mode]').forEach((button) => button.addEventListener('click', () => {
    closeHelp();
    helpMode = button.dataset.helpMode;
    document.querySelectorAll('[data-help-mode]').forEach((tab) => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    $('mock-page').hidden = helpMode !== 'guide';
    document.querySelector('.mock-sidebar').hidden = helpMode !== 'guide';
    $('mock-document').hidden = helpMode !== 'translate';
    $('mock-app-title').textContent = helpMode === 'guide' ? 'Fieldnotes — project workspace' : 'De la place pour les idées — reading preview';
    $('help-caption').textContent = 'Try the example to see how Help works over your screen.';
  }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('help-overlay').hidden) closeHelp(); });
  if ('ResizeObserver' in window) new ResizeObserver(positionAnnotation).observe($('mock-screen'));
})();

(() => {
  const links = Array.from(document.querySelectorAll('.site-map a'));
  const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  let scheduled = false;
  function updateMap() {
    scheduled = false;
    const anchor = window.innerHeight * 0.35;
    let active = sections[0];
    sections.forEach(section => { if (section.getBoundingClientRect().top <= anchor) active = section; });
    links.forEach(link => {
      if (active && link.hash === '#' + active.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', () => {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(updateMap); }
  }, { passive: true });
  window.addEventListener('resize', updateMap);
  updateMap();
})();
