/*
 * Calculette flottante du site (Sanji, 13/11/2026 : « une petite calculette affichée en plus, en pop-up, avec un truc à
 * activer de la même manière que Hors stock » ; « pas dans une nouvelle fenêtre : dans la même, comme la pastille de scan »).
 * Même calcul que l'appli (Calcul.kt) : × et ÷ avant + et −, parenthèses ; indulgente pendant la frappe.
 * Elle flotte au-dessus de la page, se déplace en la tenant par son titre, et « Mettre dans la case » met le résultat dans la
 * case de nombre en cours (la case reste ouverte : les touches de la calculette ne lui volent pas la main).
 * Chargée avant app.js (la barre du Stock lit CALCULETTE) ; elle se sert de el(), nombreJoli(), lireStockage() et
 * ecrireStockage() d'app.js, seulement quand on l'ouvre (tout est chargé à ce moment-là).
 */

/** Le résultat d'un calcul, ou null (vide, mal écrit, division par zéro) ; arrondi à 2 chiffres après la virgule. */
function resultatCalcul(texte) {
  let s = String(texte || '').replace(/\s/g, '').replace(/[×xX]/g, '*').replace(/[÷:]/g, '/').replace(/−/g, '-').replace(/,/g, '.');
  while (s && '+-*/('.includes(s.slice(-1))) s = s.slice(0, -1);   // pendant la frappe : signe ou « ( » final ignoré
  if (!s) return null;
  let ouvertes = 0;
  for (const c of s) { if (c === '(') ouvertes++; if (c === ')' && --ouvertes < 0) return null; }
  s += ')'.repeat(ouvertes);                                          // parenthèses restées ouvertes : fermées
  let i = 0;
  const somme = () => {
    let v = produit();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const w = produit(); v = op === '+' ? v + w : v - w; }
    return v;
  };
  const produit = () => {
    let v = facteur();
    for (;;) {
      if (s[i] === '*') { i++; v *= facteur(); }
      else if (s[i] === '/') { i++; const w = facteur(); if (w === 0) throw new Error('division par zéro'); v /= w; }
      else if (s[i] === '(') v *= facteur();                          // 3(24) = 3 × 24
      else return v;
    }
  };
  const facteur = () => {
    if (i >= s.length) throw new Error('fin');
    if (s[i] === '-') { i++; return -facteur(); }
    if (s[i] === '+') { i++; return facteur(); }
    if (s[i] === '(') { i++; const v = somme(); if (s[i] !== ')') throw new Error(') attendue'); i++; return v; }
    const m = /^\d*\.?\d*/.exec(s.slice(i))[0];
    if (!m || m === '.' || (m.match(/\./g) || []).length > 1) throw new Error('nombre attendu');
    i += m.length;
    return Number(m);
  };
  try {
    const v = somme();
    if (i !== s.length || !isFinite(v)) return null;
    const r = Math.round(v * 100) / 100;
    return Math.abs(r) < 1e-9 ? 0 : r;
  } catch (e) { return null; }
}

function estUnCalcul(texte) { return /[+\-−×÷*/()]/.test(String(texte || '').replace(/^[-−]/, '')); }
function affichageCalcul(texte) { return String(texte || '').replace(/([+−×÷])/g, ' $1 ').replace(/\s+/g, ' ').trim(); }

/** Une touche : chiffres, virgule, C, ⌫, + − × ÷ ( ) = (mêmes règles que le pavé de l'appli). */
function toucheCalcul(s, k) {
  const dernier = s.slice(-1);
  const apresNombre = /[0-9),]/.test(dernier);
  const ouvertes = (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  const nombreEnCours = (/[0-9,]*$/.exec(s) || [''])[0];
  switch (k) {
    case 'C': return '';
    case '⌫': return s.slice(0, -1);
    case '=': { const r = resultatCalcul(s); return estUnCalcul(s) && r !== null ? nombreJoli(r) : s; }
    case '+': case '−': case '×': case '÷':
      if (!dernier || dernier === '(') return s;                      // rien avant : le signe n'a pas de sens
      if ('+−×÷'.includes(dernier)) return s.slice(0, -1) + k;        // on change d'avis sur le signe
      return s + k;
    case '(': return apresNombre ? s + '×(' : s + '(';
    case ')': return ouvertes > 0 && apresNombre ? s + ')' : s;
    case ',':
      if (nombreEnCours.includes(',')) return s;
      return (/[0-9]$/.test(s) ? s : s + (dernier === ')' ? '×0' : '0')) + ',';
    default:                                                         // un chiffre
      if (s.length >= 40 || nombreEnCours.replace(',', '').length >= 9) return s;
      if (dernier === ')') return s + '×' + k;
      if (nombreEnCours === '0') return s.slice(0, -1) + k;
      return s + k;
  }
}

const CALCULETTE = { vue: null, saisie: '' };

/** La case de nombre en cours (tableau, barre « Sélection multiple », fenêtres), s'il y en a une. */
function caseNombreActive() {
  const a = document.activeElement;
  const nombre = a && a.tagName === 'INPUT' && (a.getAttribute('inputmode') === 'decimal' || a.dataset.pave);
  return nombre && !(CALCULETTE.vue && CALCULETTE.vue.contains(a)) ? a : null;
}

// ------------------------------------------------------------------ le pavé du bas, sur téléphone

/*
 * Sanji, 13/11 : « jamais de clavier du téléphone pour les nombres, nulle part (sauf là où il faut des lettres) » ;
 * « comme un clavier de téléphone : il reste à sa place en bas » ; le site sur téléphone fait comme l'appli.
 * Sur un écran tactile sans souris, chaque case de nombre (créée par el() avec inputmode « decimal ») est préparée :
 * le clavier du téléphone ne s'ouvre pas, c'est ce pavé qui monte. Les touches d'action dépendent de la case :
 * « OK » d'office ; « Mètres » / « Kg » pour une bobine ; « Carton » / « Descente » pour les descentes.
 * Sur un ordinateur, rien ne change (on tape au clavier ; un calcul tapé est accepté aussi).
 */
const SAISIE_TACTILE = (() => { try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch (e) { return false; } })();

/** Appelée par el() pour chaque case de nombre. */
function preparerCaseNombre(input) {
  if (!SAISIE_TACTILE) return;
  input.setAttribute('inputmode', 'none');
  input.readOnly = true;                      // aucun clavier du téléphone, même là où « inputmode » n'est pas compris
  input.dataset.pave = '1';
}

const PAVE = { vue: null, cible: null, saisie: '', remplacer: false, ecranCalcul: null, ecranResultat: null, ecranTitre: null, ecranDetail: null, actions: null };

function construirePave() {
  const garder = ev => ev.preventDefault();           // toucher le pavé ne fait pas quitter la case
  const touche = k => el('button', { class: 'pave-touche' + ('÷×−+()=,'.includes(k) ? ' signe' : ''), tabindex: '-1', type: 'button',
    onclick: () => appuyerPave(k) }, k);
  PAVE.ecranTitre = el('div', { class: 'pave-titre' });
  PAVE.ecranCalcul = el('div', { class: 'calc-calcul' });
  PAVE.ecranResultat = el('div', { class: 'calc-resultat' });
  PAVE.ecranDetail = el('div', { class: 'pave-detail' });
  PAVE.actions = el('div', { class: 'pave-actions' });
  PAVE.vue = el('div', { class: 'pave', role: 'group', 'aria-label': 'Pavé de nombres' },
    el('div', { class: 'pave-ecran' }, PAVE.ecranTitre, el('div', { class: 'pave-droite' }, PAVE.ecranCalcul, PAVE.ecranResultat, PAVE.ecranDetail)),
    el('div', { class: 'pave-touches' },
      ['7', '8', '9', '÷', '(', '4', '5', '6', '×', ')', '1', '2', '3', '−', ',', 'C', '0', '⌫', '+', '='].map(touche)),
    PAVE.actions);
  PAVE.vue.addEventListener('mousedown', garder);
  PAVE.vue.addEventListener('pointerdown', garder);
  document.body.append(PAVE.vue);
}

/** Les touches d'action selon la case : bobine, descentes, ou « OK ». */
function actionsPave(cible) {
  const bouton = (lib, faire, actif = true) => el('button', { class: 'pave-action', type: 'button', tabindex: '-1', disabled: !actif, onclick: faire }, lib);
  if (cible.dataset.bobine) {
    const coef = num(cible.dataset.coef);
    return [bouton('Mètres', () => validerPave('m')), bouton('Kg', () => validerPave('kg'), coef !== null && coef > 0)];
  }
  if (cible.dataset.descente) return [bouton('Carton', () => validerPave('cartons')), bouton('Descente', () => validerPave('tuyaux'))];
  return [bouton('OK', () => validerPave('ok'))];
}

function ouvrirPave(cible) {
  if (!PAVE.vue) construirePave();
  PAVE.cible = cible;
  PAVE.saisie = String(cible.value || '').trim().replace(/\./g, ',');
  PAVE.remplacer = PAVE.saisie !== '';               // un chiffre remplace la valeur, un signe la continue (120 − 30)
  const etiquette = cible.id && document.querySelector(`label[for="${cible.id}"]`);
  PAVE.ecranTitre.textContent = cible.dataset.titre || (etiquette && etiquette.textContent) || cible.placeholder || 'Nombre';
  vider(PAVE.actions).append(...actionsPave(cible));
  PAVE.vue.classList.add('ouvert');
  document.body.classList.add('avec-pave');
  majPave();                                         // l'écran rempli d'abord : la hauteur mesurée est la bonne
  document.documentElement.style.setProperty('--hauteur-pave', PAVE.vue.offsetHeight + 'px');
  // La case reste visible au-dessus du pavé
  setTimeout(() => {
    try {
      document.documentElement.style.setProperty('--hauteur-pave', PAVE.vue.offsetHeight + 'px');
      cible.scrollIntoView({ block: 'nearest' });
      const bas = cible.getBoundingClientRect().bottom, limite = window.innerHeight - PAVE.vue.offsetHeight - 10;
      if (bas > limite) window.scrollBy(0, bas - limite);
    } catch (e) { /* rien */ }
  }, 50);
}

function fermerPave() {
  if (!PAVE.vue) return;
  PAVE.vue.classList.remove('ouvert');
  document.body.classList.remove('avec-pave');
  PAVE.cible = null;
}

function appuyerPave(k) {
  if (!PAVE.cible) return;
  if (PAVE.remplacer && !['⌫', 'C', '=', '+', '−', '×', '÷'].includes(k)) PAVE.saisie = '';
  PAVE.remplacer = false;
  PAVE.saisie = toucheCalcul(PAVE.saisie, k);
  // Le résultat va tout de suite dans la case (toucher ailleurs l'enregistre, comme au clavier) ; un calcul impossible
  // ne la change pas
  // (pas pour les descentes : c'est « Carton » ou « Descente » qui dit dans quelle case va le nombre)
  const r = PAVE.saisie ? resultatCalcul(PAVE.saisie) : null;
  if (!PAVE.cible.dataset.descente) {
    if (!PAVE.saisie) PAVE.cible.value = '';
    else if (r !== null) PAVE.cible.value = nombreJoli(r);
    PAVE.cible.dispatchEvent(new Event('input', { bubbles: true }));
  }
  majPave();
}

function majPave() {
  const s = PAVE.saisie, calcul = estUnCalcul(s), r = s ? resultatCalcul(s) : null;
  PAVE.ecranCalcul.textContent = calcul ? `${affichageCalcul(s)} =` : ' ';
  PAVE.ecranResultat.textContent = !s ? '—' : calcul ? (r === null ? '?' : nombreJoli(r)) : s;
  PAVE.ecranResultat.classList.toggle('vide', !s);
  const coef = PAVE.cible && PAVE.cible.dataset.bobine ? num(PAVE.cible.dataset.coef) : null;
  PAVE.ecranDetail.textContent = calcul && r === null ? 'calcul impossible'
    : (r !== null && coef ? `en Kg : ${nombreJoli(Math.floor(r / coef + 1e-9))} ml` : '');
}

/** Les cases à pavé qui suivent celle-ci, dans le même cadre (fenêtre ou page). */
function caseSuivante(cible, filtre) {
  const cadre = cible.closest('.fenetre, .barre-lot, main') || document;
  const toutes = [...cadre.querySelectorAll('input[data-pave]')].filter(filtre || (() => true));
  const i = toutes.indexOf(cible);
  return i >= 0 ? toutes[i + 1] || null : null;
}

function validerPave(quoi) {
  const c = PAVE.cible; if (!c) return;
  const s = PAVE.saisie, r = s ? resultatCalcul(s) : null;
  if (s && r === null) { PAVE.ecranDetail.textContent = 'calcul impossible : vérifie-le'; return; }
  if (r !== null && r < 0) { PAVE.ecranDetail.textContent = 'le résultat est négatif'; return; }
  if (quoi === 'cartons' || quoi === 'tuyaux') {
    // Descentes : le nombre va dans « Cartons » ou « Descentes », quelle que soit la case touchée
    const cadre = c.closest('.fenetre') || document;
    const dest = cadre.querySelector(`input[data-descente="${quoi}"]`) || c;
    if (s) { dest.value = nombreJoli(r); dest.dataset.avant = dest.value; dest.dispatchEvent(new Event('input', { bubbles: true })); }
    PAVE.saisie = ''; PAVE.remplacer = false;
    if (dest !== c) dest.focus(); else majPave();
    return;
  }
  if (quoi === 'm' || quoi === 'kg') {
    // Bobines : la longueur, ou le poids converti en mètres ; puis la bobine suivante
    if (s) {
      const coef = num(c.dataset.coef);
      const m = quoi === 'kg' && coef ? Math.floor(r / coef + 1e-9) : r;
      if (m <= 0) {
        c.value = c.dataset.avant || ''; c.dispatchEvent(new Event('input', { bubbles: true }));
        PAVE.saisie = ''; majPave();
        PAVE.ecranDetail.textContent = 'une bobine à 0 n\'existe pas : touche ✕ pour l\'enlever';
        return;
      }
      c.value = nombreJoli(m);
      c.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Une bobine du tableau (le total déplié) : elle s'enregistre, comme avec Entrée
    if (c.classList.contains('dans-case')) { c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return; }
    const suivante = caseSuivante(c, x => !!x.dataset.bobine);
    if (suivante && (s || c.value.trim())) suivante.focus(); else c.blur();
    return;
  }
  // « OK » : la case prend le résultat ; une case du tableau s'enregistre (comme Entrée) ; sinon la case suivante
  if (s) c.value = nombreJoli(r);
  c.dispatchEvent(new Event('input', { bubbles: true }));
  if (c.classList.contains('dans-case')) { c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return; }
  const suivante = caseSuivante(c);
  if (suivante) suivante.focus(); else c.blur();
}

// La case touchée appelle le pavé ; il se range quand on quitte les cases de nombres
document.addEventListener('focusin', ev => {
  const c = ev.target;
  if (c && c.tagName === 'INPUT' && c.dataset.pave) { c.dataset.avant = c.value; ouvrirPave(c); }
});
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (!(a && a.tagName === 'INPUT' && a.dataset.pave)) fermerPave();
}, 0));

function majBoutonsCalculette() {
  const ouverte = !!CALCULETTE.vue;
  document.querySelectorAll('[data-calculette]').forEach(b => { b.classList.toggle('actif', ouverte); b.setAttribute('aria-pressed', ouverte ? 'true' : 'false'); });
}

function basculerCalculette() { if (CALCULETTE.vue) fermerCalculette(); else ouvrirCalculette(); }

function fermerCalculette() {
  if (CALCULETTE.vue) CALCULETTE.vue.remove();
  CALCULETTE.vue = null;
  document.removeEventListener('focusin', majDansLaCase); document.removeEventListener('focusout', majDansLaCase);
  window.removeEventListener('resize', garderDansLEcran);
  majBoutonsCalculette();
}

let majDansLaCase = () => {};
function garderDansLEcran() {
  const v = CALCULETTE.vue; if (!v) return;
  const l = Math.min(Math.max(4, v.offsetLeft), window.innerWidth - v.offsetWidth - 4);
  const h = Math.min(Math.max(4, v.offsetTop), window.innerHeight - v.offsetHeight - 4);
  v.style.left = l + 'px'; v.style.top = h + 'px';
}

function ouvrirCalculette() {
  if (CALCULETTE.vue) return;
  const calculVue = el('div', { class: 'calc-calcul' });
  const resultatVue = el('div', { class: 'calc-resultat' });
  const dansLaCase = el('button', { class: 'calc-case', tabindex: '-1', disabled: true, title: 'Clique d\'abord dans une case de nombre' }, 'Mettre dans la case');
  const maj = () => {
    const s = CALCULETTE.saisie, calcul = estUnCalcul(s), r = s ? resultatCalcul(s) : null;
    calculVue.textContent = calcul ? `${affichageCalcul(s)} =` : ' ';
    resultatVue.textContent = !s ? '0' : calcul ? (r === null ? '?' : nombreJoli(r)) : s;
    resultatVue.classList.toggle('vide', !s);
    resultatVue.title = calcul && r === null ? 'Calcul impossible' : '';
  };
  const appuyer = k => { CALCULETTE.saisie = toucheCalcul(CALCULETTE.saisie, k); maj(); };
  const touche = k => el('button', { class: 'calc-touche' + ('÷×−+()=,'.includes(k) ? ' signe' : '') + (k === '=' ? ' egal' : ''), tabindex: '-1',
    onclick: () => appuyer(k) }, k);
  const pave = el('div', { class: 'calc-pave' },
    ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', 'C', '0', '⌫', '+', '(', ')', ',', '='].map(touche));
  dansLaCase.addEventListener('click', () => {
    const c = caseNombreActive(), r = resultatCalcul(CALCULETTE.saisie);
    if (!c || r === null) return;
    // Un morceau sélectionné : il est remplacé ; une liste qui finit par « + » (les bobines : 80 + 42,5 + …) : le résultat
    // s'ajoute au bout ; sinon la case prend le résultat
    const t = nombreJoli(r), a = c.selectionStart, b = c.selectionEnd;
    if (a !== null && b !== null && b > a) c.setRangeText(t, a, b, 'end');
    else if (/\+\s*$/.test(c.value)) c.value = c.value.replace(/\s*$/, ' ') + t;
    else c.value = t;
    c.dispatchEvent(new Event('input', { bubbles: true }));
    c.focus();
  });
  const titre = el('div', { class: 'calc-titre', title: 'Tiens-moi pour me déplacer' }, el('span', {}, '⠿ Calculette'),
    el('button', { class: 'calc-fermer', tabindex: '-1', title: 'Fermer', 'aria-label': 'Fermer la calculette', onclick: fermerCalculette }, '✕'));
  const vue = el('div', { class: 'calculette', tabindex: '0', role: 'dialog', 'aria-label': 'Calculette' },
    titre, el('div', { class: 'calc-ecran' }, calculVue, resultatVue), pave, dansLaCase);

  // Toucher la calculette ne ferme pas la case en cours (une case du tableau s'enregistre quand on la quitte) ;
  // sans case en cours, la calculette prend le clavier (chiffres, + - * / ( ) , Entrée, ⌫, Suppr).
  vue.addEventListener('mousedown', ev => {
    ev.preventDefault();
    if (!caseNombreActive()) vue.focus({ preventScroll: true });
  });
  vue.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = { '*': '×', 'x': '×', 'X': '×', '/': '÷', ':': '÷', '-': '−', '+': '+', '.': ',', ',': ',', '(': '(', ')': ')',
      'Enter': '=', '=': '=', 'Backspace': '⌫', 'Delete': 'C', 'c': 'C', 'C': 'C' }[ev.key] || (/^\d$/.test(ev.key) ? ev.key : null);
    if (!k && ev.key !== ' ') return;
    ev.preventDefault(); ev.stopPropagation();
    if (k) appuyer(k);
  });

  // Déplacer : tenir le titre (souris ou doigt), comme la pastille SCAN de l'appli ; la place est retenue sur cet appareil
  titre.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.calc-fermer')) return;
    const dx = ev.clientX - vue.offsetLeft, dy = ev.clientY - vue.offsetTop;
    titre.setPointerCapture(ev.pointerId);
    const bouger = e => { vue.style.left = (e.clientX - dx) + 'px'; vue.style.top = (e.clientY - dy) + 'px'; garderDansLEcran(); };
    const lacher = () => {
      titre.removeEventListener('pointermove', bouger); titre.removeEventListener('pointerup', lacher); titre.removeEventListener('pointercancel', lacher);
      ecrireStockage('sd_calculette_place', JSON.stringify({ x: vue.offsetLeft, y: vue.offsetTop }));
    };
    titre.addEventListener('pointermove', bouger); titre.addEventListener('pointerup', lacher); titre.addEventListener('pointercancel', lacher);
  });

  majDansLaCase = () => setTimeout(() => {
    const ok = !!caseNombreActive();
    dansLaCase.disabled = !ok;
    dansLaCase.title = ok ? 'Met le résultat dans la case en cours' : 'Clique d\'abord dans une case de nombre';
  }, 0);
  document.addEventListener('focusin', majDansLaCase); document.addEventListener('focusout', majDansLaCase);
  window.addEventListener('resize', garderDansLEcran);

  CALCULETTE.vue = vue;
  document.body.append(vue);
  maj();                                  // l'écran rempli d'abord : la hauteur est la bonne pour la placer
  let place = null;
  try { place = JSON.parse(lireStockage('sd_calculette_place') || 'null'); } catch (e) { place = null; }
  vue.style.left = (place ? place.x : window.innerWidth - vue.offsetWidth - 16) + 'px';
  vue.style.top = (place ? place.y : window.innerHeight - vue.offsetHeight - 16) + 'px';
  garderDansLEcran();
  majDansLaCase(); majBoutonsCalculette();
  if (!caseNombreActive()) vue.focus({ preventScroll: true });
}
