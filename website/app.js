(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const svg = $('journey-svg');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const routes = ['stem', 'chat', 'help', 'end'].map((name) => ({
    name,
    track: $(`${name}-track`),
    progress: $(`${name}-progress`),
    traveler: $(`${name}-traveler`),
    samples: []
  }));
  let frame = 0;
  let measurePending = true;
  let mainTop = 0;
  let splitY = 0;
  let mergeY = 0;
  let originY = 0;
  let endY = 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function center(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + window.scrollY - mainTop };
  }
  function setRoute(name, data) {
    const route = routes.find((item) => item.name === name);
    route.track.setAttribute('d', data);
    route.progress.setAttribute('d', data);
    route.length = route.track.getTotalLength();
    route.samples = Array.from({ length: 161 }, (_, index) => {
      const length = route.length * index / 160;
      return { length, y: route.track.getPointAtLength(length).y };
    });
    route.progress.style.strokeDasharray = String(route.length);
  }
  function measure() {
    mainTop = main.getBoundingClientRect().top + window.scrollY;
    const origin = center($('journey-origin'));
    const end = center($('journey-end'));
    const featureTop = $('features').getBoundingClientRect().top + window.scrollY - mainTop;
    const chatPoints = [...document.querySelectorAll('[data-journey-point="chat"]')].map(center);
    const helpPoints = [...document.querySelectorAll('[data-journey-point="help"]')].map(center);
    originY = origin.y;
    endY = end.y;
    splitY = featureTop + 24;
    mergeY = end.y - 34;
    const mid = window.innerWidth / 2;
    const height = end.y + 12;
    $('journey').style.height = `${height}px`;
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${height}`);
    setRoute('stem', `M ${origin.x} ${origin.y} L ${mid} ${splitY}`);
    function branch(name, points) {
      const first = points[0];
      const last = points[points.length - 1];
      const sectionBottom = $(name).getBoundingClientRect().bottom + window.scrollY - mainTop + 20;
      const narrow = window.innerWidth <= 520;
      let path;
      if (narrow && name === 'help') {
        const lane = window.innerWidth - 18;
        const turn = first.y - 68;
        path = `M ${mid} ${splitY} C ${mid} ${splitY + 48}, ${lane} ${splitY + 48}, ${lane} ${splitY + 105} L ${lane} ${turn - 45} C ${lane} ${turn}, ${first.x} ${turn}, ${first.x} ${first.y}`;
      } else {
        path = `M ${mid} ${splitY} C ${mid} ${splitY + 54}, ${first.x} ${first.y - 76}, ${first.x} ${first.y}`;
      }
      points.slice(1).forEach((point) => { path += ` L ${point.x} ${point.y}`; });
      path += ` L ${last.x} ${sectionBottom}`;
      if (narrow && name === 'chat') {
        path += ` C ${last.x} ${sectionBottom + 35}, 18 ${sectionBottom + 35}, 18 ${sectionBottom + 70} L 18 ${mergeY - 70} C 18 ${mergeY - 25}, ${mid} ${mergeY - 65}, ${mid} ${mergeY}`;
      } else {
        const bend = Math.min(100, (mergeY - sectionBottom) * .45);
        path += ` C ${last.x} ${mergeY - bend}, ${mid} ${mergeY - bend}, ${mid} ${mergeY}`;
      }
      setRoute(name, path);
    }
    branch('chat', chatPoints);
    branch('help', helpPoints);
    setRoute('end', `M ${mid} ${mergeY} L ${end.x} ${end.y}`);
    measurePending = false;
  }
  function lengthAtY(route, y) {
    const samples = route.samples;
    if (y <= samples[0].y) return 0;
    if (y >= samples[samples.length - 1].y) return route.length;
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (samples[middle].y < y) low = middle;
      else high = middle;
    }
    const from = samples[low];
    const to = samples[high];
    const fraction = (y - from.y) / (to.y - from.y || 1);
    return from.length + (to.length - from.length) * fraction;
  }
  function render() {
    frame = 0;
    if (measurePending) measure();
    // Progress is derived from scroll position, so every branch retraces on scroll up.
    const progressY = window.scrollY + window.innerHeight * .58 - mainTop;
    const activeY = clamp(progressY, originY, endY);
    routes.forEach((route) => {
      const length = reducedMotion.matches ? route.length : lengthAtY(route, activeY);
      route.progress.style.strokeDashoffset = String(route.length - length);
      const point = route.track.getPointAtLength(length);
      route.traveler.setAttribute('transform', `translate(${point.x} ${point.y})`);
      const active = route.name === 'stem' ? activeY < splitY : route.name === 'end' ? activeY >= mergeY : activeY >= splitY && activeY < mergeY;
      route.traveler.style.opacity = active && progressY > originY && progressY < endY ? '1' : '0';
    });
    document.querySelectorAll('[data-journey-point]').forEach((node) => {
      node.classList.toggle('is-reached', reducedMotion.matches || center(node).y <= activeY);
    });
    const showDownload = $('hero-download').getBoundingClientRect().bottom < 0;
    $('floating-download').classList.toggle('is-visible', showDownload);
    $('floating-download').setAttribute('aria-hidden', String(!showDownload));
    $('floating-download').tabIndex = showDownload ? 0 : -1;
  }
  function schedule(measureAgain = false) {
    measurePending = measurePending || measureAgain;
    if (!frame) frame = window.requestAnimationFrame(render);
  }
  window.addEventListener('scroll', () => schedule(), { passive: true });
  window.addEventListener('resize', () => schedule(true));
  reducedMotion.addEventListener('change', () => schedule());
  document.querySelectorAll('.feature-detail').forEach((detail) => detail.addEventListener('toggle', () => schedule(true)));
  if ('ResizeObserver' in window) new ResizeObserver(() => schedule(true)).observe(main);
  document.fonts.ready.then(() => schedule(true)).catch(() => schedule(true));
  schedule(true);
})();
