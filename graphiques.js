/* Stock Dépôt — onglet 📈 Graphiques (Sanji, 12/11/2026)
 *
 * Sanji : « un nouvel onglet graphique, dans lequel on pourrait directement choisir sur quelle période, de quoi, combien,
 * et le graphique se fait en fonction des paramètres cochés ; ça permettrait d'établir plus tard des pronostics, voire même
 * un seuil minimum conseillé ».
 *
 * Comment c'est calculé : le site connaît l'état ACTUEL de chaque article ; lire_series_stock rend les changements de stock
 * depuis le début de la période (chacun avec sa valeur d'avant). On remonte le temps depuis maintenant : chaque changement
 * donne la valeur juste avant lui. Une baisse entre deux comptages = des sorties (consommation) ; une hausse = des entrées.
 * Les pronostics (consommation moyenne, « tient encore », seuil conseillé) viennent de ces sorties.
 *
 * Ce fichier est chargé AVANT app.js ; il se sert de ses fonctions (el, tous, rpc, moi, num, metres, metresDescente,
 * niveaux, FILTRES_STOCK, libelleFiltre, teintesDe…) seulement quand on ouvre l'onglet.
 */

const JOUR_MS = 86400000;
const DEBUT_HISTORIQUE = Date.parse('2026-11-06T00:00:00+01:00');   // le document garde l'historique depuis le 6/11/2026
const PERIODES = [['7', '7 jours'], ['30', '30 jours'], ['91', '3 mois'], ['182', '6 mois'], ['365', '1 an'], ['tout', 'Tout'], ['perso', 'Dates…']];
const PAS = [['auto', 'Auto'], ['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']];
const MAX_COURBES = 8;            // 8 couleurs au plus (au-delà : les 8 qui bougent le plus, le reste en total)
const MARGE_SEUIL = 1.5;          // seuil conseillé = consommation par jour × jours avant d'aller chercher × 1,5
// Sanji, 12/11 : « pas de livraison, c'est moi qui vais chercher, donc pas de délai » : 3 jours d'office (le temps d'y
// aller, week-end compris), au lieu des 14 jours de réassort supposés au départ ; réglable dans la page.
const DELAI_DEFAUT = 3;

/** Les réglages de l'onglet, gardés pour la session (le délai de réassort, lui, sur l'appareil). */
function etatGraph() {
  if (!etat.graph) etat.graph = {
    periode: '30', du: '', au: '', mesures: { stock: true, sorties: true, entrees: false }, pas: 'auto', affichage: 'total',
    filtres: {}, recherche: '', exclus: new Set(), cache: null, delai: num(lireStockage('sd_delai_chercher')) || DELAI_DEFAUT,
  };
  return etat.graph;
}

// ------------------------------------------------------------------ dates

function debutJour(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function bornesGraph(g) {
  const maintenant = Date.now();
  let fin = maintenant, debut;
  if (g.periode === 'perso') {
    fin = g.au ? Math.min(maintenant, debutJour(Date.parse(g.au + 'T12:00:00')) + JOUR_MS - 1) : maintenant;
    debut = g.du ? debutJour(Date.parse(g.du + 'T12:00:00')) : fin - 30 * JOUR_MS;
  } else if (g.periode === 'tout') debut = DEBUT_HISTORIQUE;
  else debut = fin - Number(g.periode) * JOUR_MS;
  if (debut >= fin) debut = fin - JOUR_MS;
  return { debut, fin };
}
function pasEffectif(g, debut, fin) {
  if (g.pas !== 'auto') return g.pas;
  const jours = (fin - debut) / JOUR_MS;
  return jours <= 31 ? 'jour' : jours <= 200 ? 'semaine' : 'mois';
}
function debutCase(t, pas) {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  if (pas === 'semaine') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));     // le lundi
  if (pas === 'mois') d.setDate(1);
  return d.getTime();
}
function caseSuivante(t, pas) {
  const d = new Date(t);
  if (pas === 'jour') d.setDate(d.getDate() + 1); else if (pas === 'semaine') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}
const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
function libelleCase(t, pas) { return pas === 'mois' ? fmtMois.format(new Date(t)) : (pas === 'semaine' ? 'sem. du ' : '') + fmtJour.format(new Date(t)); }

// ------------------------------------------------------------------ les données

/** Les changements de stock depuis `depuis` (gardés 2 minutes, et réutilisés pour une période plus courte). */
async function chargerSeries(depuis) {
  const g = etatGraph();
  if (g.cache && g.cache.depuis <= depuis && Date.now() - g.cache.lu < 120000) return g.cache.lignes;
  const r = await rpc('lire_series_stock', { ...moi(), p_depuis: new Date(depuis).toISOString() });
  if (!r.ok) throw new Error(r.message);
  g.cache = { depuis, lu: Date.now(), lignes: r.lignes || [] };
  return g.cache.lignes;
}

/** L'unité dans laquelle on suit un article (on n'additionne jamais deux unités différentes). */
function uniteGraph(t, o) {
  if (t !== 'accessoires') return 'ml';
  const mode = o.mode || 'quantite';
  if (mode === 'niveau') return 'niveau';
  if (mode === 'mixte') return 'cartons fermés';
  return o.unite || 'pièces';
}
/** La valeur suivie : pièces / cartons, mètres (bobines, descentes), ou le rang du niveau (0 = vide). null = pas compté. */
function valeurGraph(t, o) {
  if (!o) return null;
  if (t === 'bobines') { const m = metres(o); return m.length ? m.reduce((a, x) => a + x, 0) : (o.compte ? 0 : null); }
  if (t === 'descentes') return metresDescente(o);
  if ((o.mode || 'quantite') === 'niveau') { const i = niveaux().findIndex(n => n[0] === o.niveau); return i < 0 ? null : i; }
  return num(o.quantite);
}
/** L'état d'un article juste AVANT un changement (null : il n'existait pas encore). */
function defaire(cur, h) {
  if (h.a === 'creation') return null;
  const c = { ...cur };
  Object.entries(h.c || {}).forEach(([k, ch]) => { if (ch && typeof ch === 'object' && 'avant' in ch) c[k] = ch.avant; });
  return c;
}
/** La courbe d'un article sur [debut, fin] : [[instant, valeur]…] dans l'ordre, la valeur tenant jusqu'au point suivant. */
function serieArticle(t, o, lignes, debut, fin) {
  let cur = { ...o };
  const pts = [];
  let j = lignes.length - 1;
  for (; j >= 0 && Date.parse(lignes[j].q) > fin; j--) { cur = defaire(cur, lignes[j]); if (!cur) return []; }
  pts.push([fin, valeurGraph(t, cur)]);
  for (; j >= 0; j--) {
    const q = Date.parse(lignes[j].q);
    if (q < debut) break;
    pts.push([q, valeurGraph(t, cur)]);
    cur = defaire(cur, lignes[j]);
    if (!cur) break;
  }
  // Avant le début de l'historique, on ne sait rien : la courbe commence là (pas de stock « stable » inventé avant)
  if (cur && fin > DEBUT_HISTORIQUE) pts.push([Math.max(debut, DEBUT_HISTORIQUE), valeurGraph(t, cur)]);
  pts.reverse();
  const net = [];
  pts.forEach(p => { if (net.length && net[net.length - 1][0] === p[0]) net[net.length - 1] = p; else net.push(p); });
  return net;
}
/** La valeur d'une courbe à un instant (le dernier point avant lui). */
function valeurA(pts, t) {
  let v = null;
  for (const p of pts) { if (p[0] > t) break; v = p[1]; }
  return v;
}
/** Sorties (baisses) et entrées (hausses) entre deux points connus : [[instant, variation]…]. */
function variations(pts) {
  const l = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1][1], b = pts[i][1];
    if (a === null || b === null || a === b) continue;
    l.push([pts[i][0], b - a]);
  }
  return l;
}
/** La somme de plusieurs courbes (même unité) à chaque instant où l'une d'elles change. */
function serieTotale(series) {
  const temps = [...new Set(series.flatMap(s => s.pts.map(p => p[0])))].sort((a, b) => a - b);
  return temps.map(t => {
    let somme = null;
    series.forEach(s => { const v = valeurA(s.pts, t); if (v !== null) somme = (somme || 0) + v; });
    return [t, somme];
  });
}

// ------------------------------------------------------------------ l'onglet

function pageGraphiques(corps) {
  const g = etatGraph();
  const resultats = el('div', { class: 'graph-resultats' });

  // 1. Période
  const puPeriode = el('div', { class: 'puces' });
  const dates = el('div', { class: 'rangee', style: 'margin:-4px 0 8px' });
  function dessinerPeriode() {
    vider(puPeriode).append(...PERIODES.map(([k, lib]) => el('button', { class: g.periode === k ? 'actif' : '', onclick: () => { g.periode = k; dessinerPeriode(); calculer(); } }, lib)));
    vider(dates);
    if (g.periode === 'perso') {
      const du = el('input', { type: 'date', value: g.du, onchange: () => { g.du = du.value; calculer(); } });
      const au = el('input', { type: 'date', value: g.au, onchange: () => { g.au = au.value; calculer(); } });
      dates.append(el('span', { class: 'aide' }, 'du'), du, el('span', { class: 'aide' }, 'au'), au);
    }
  }

  // 2. Quoi : les mêmes filtres que le Stock, la recherche, et les articles à cocher
  const zoneFiltres = el('div', { class: 'filtres' });
  const recherche = el('input', { type: 'search', placeholder: 'Chercher un article, une réf, une couleur', value: g.recherche });
  recherche.addEventListener('input', () => { g.recherche = recherche.value; dessinerChoix(); calculer(); });
  const zoneChoix = el('div');
  const tousArticles = () => ARTICLES.flatMap(t => tous(t).filter(o => t !== 'accessoires' || o.suivi !== false).map(o => ({ t, o, cle: t + '|' + o.id })));
  const passe = (x, sauf) => FILTRES_STOCK.every(([k, , f]) => k === sauf || !g.filtres[k] || f(x.t, x.o).includes(g.filtres[k]));
  function candidats() {
    const mots = normaliser(g.recherche).split(/\s+/).filter(Boolean);
    return tousArticles().filter(x => passe(x, null) && (!mots.length || mots.every(m =>
      normaliser([x.o.ref, x.o.nom, x.o.nom_court, x.o.zone, x.o.fournisseur, x.o.famille, couleurDe(x.t, x.o), dimensionDe(x.t, x.o)].join(' ')).includes(m))));
  }
  function dessinerFiltres() {
    vider(zoneFiltres);
    FILTRES_STOCK.forEach(([k, lib, f]) => {
      const compte = new Map();
      tousArticles().filter(x => passe(x, k)).forEach(x => f(x.t, x.o).filter(Boolean).forEach(v => compte.set(v, (compte.get(v) || 0) + 1)));
      if (g.filtres[k] && !compte.has(g.filtres[k])) compte.set(g.filtres[k], 0);
      const valeurs = [...compte.keys()].sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));
      const s = el('select', { class: g.filtres[k] ? 'actif' : '', 'aria-label': lib, onchange: () => {
        if (s.value) g.filtres[k] = s.value; else delete g.filtres[k];
        dessinerFiltres(); dessinerChoix(); calculer();
      } }, el('option', { value: '' }, `${lib} : tout`), valeurs.map(v => el('option', { value: v }, `${lib} : ${libelleFiltre(k, v)} (${compte.get(v)})`)));
      s.value = g.filtres[k] || '';
      zoneFiltres.append(s);
    });
    if (Object.keys(g.filtres).length) zoneFiltres.append(el('button', { class: 'petit', onclick: () => { g.filtres = {}; dessinerFiltres(); dessinerChoix(); calculer(); } }, '✕ Effacer les filtres'));
  }
  function dessinerChoix() {
    const l = candidats();
    const liste = el('div', { class: 'graph-choix' }, l.slice(0, 300).map(x => el('label', { class: 'case' },
      el('input', { type: 'checkbox', checked: !g.exclus.has(x.cle), onchange: ev => {
        if (ev.target.checked) g.exclus.delete(x.cle); else g.exclus.add(x.cle);
        majResume(); calculer();
      } }), `${x.o.nom_court || x.o.nom || x.o.ref}`, el('span', { class: 'aide' }, '  ' + (x.o.ref || '')))));
    const resume = el('summary', {});
    const majResume = () => { const k = l.filter(x => !g.exclus.has(x.cle)).length; resume.textContent = `Articles : ${k} coché${k > 1 ? 's' : ''} sur ${l.length}`; };
    majResume();
    vider(zoneChoix).append(el('details', { class: 'dossier', style: 'margin:0 0 10px' }, resume,
      el('div', { style: 'padding:0 14px 10px' },
        el('div', { class: 'rangee', style: 'margin:0 0 6px' },
          el('button', { class: 'petit', onclick: () => { l.forEach(x => g.exclus.delete(x.cle)); dessinerChoix(); calculer(); } }, 'Tout cocher'),
          el('button', { class: 'petit', onclick: () => { l.forEach(x => g.exclus.add(x.cle)); dessinerChoix(); calculer(); } }, 'Tout décocher')),
        liste,
        l.length > 300 ? el('p', { class: 'aide' }, `(${l.length - 300} autres, cochés : affine avec les filtres pour les voir)`) : null)));
  }

  // 3. Combien : ce qu'on veut voir, le regroupement, total ou un par article
  const zoneMesures = el('div', { class: 'graph-options' });
  function dessinerMesures() {
    const coche = (k, lib) => el('label', { class: 'case' }, el('input', { type: 'checkbox', checked: g.mesures[k], onchange: ev => { g.mesures[k] = ev.target.checked; calculer(); } }), lib);
    const choix = (liste, val, poser) => el('div', { class: 'puces', style: 'margin:4px 0' }, liste.map(([k, lib]) =>
      el('button', { class: val === k ? 'actif' : '', onclick: () => { poser(k); dessinerMesures(); calculer(); } }, lib)));
    vider(zoneMesures).append(
      el('div', { class: 'rangee' }, coche('stock', 'Stock (ce qu\'il y a)'), coche('sorties', 'Sorties (ce qui part)'), coche('entrees', 'Entrées (ce qui arrive)')),
      el('div', { class: 'aide', style: 'margin-top:6px' }, 'Regrouper les sorties et entrées par'),
      choix(PAS, g.pas, k => { g.pas = k; }),
      el('div', { class: 'aide' }, 'Afficher'),
      choix([['total', 'Le total'], ['detail', 'Un par article']], g.affichage, k => { g.affichage = k; }));
  }

  let tour = 0;
  async function calculer() {
    const ce = ++tour;
    const { debut, fin } = bornesGraph(g);
    resultats.classList.add('en-cours');
    if (!resultats.childElementCount) resultats.append(el('p', { class: 'aide' }, 'Chargement…'));
    try {
      const lignes = await chargerSeries(Math.min(debut, g.cache ? g.cache.depuis : debut));
      if (ce !== tour) return;
      vider(resultats).append(...resultatsGraph(g, candidats().filter(x => !g.exclus.has(x.cle)), lignes, debut, fin));
    } catch (e) { if (ce === tour) vider(resultats).append(el('p', { class: 'erreur' }, e.message)); }
    resultats.classList.remove('en-cours');
  }

  dessinerPeriode(); dessinerFiltres(); dessinerChoix(); dessinerMesures();
  corps.append(
    el('div', { class: 'titre-section' }, 'Période'), puPeriode, dates,
    el('div', { class: 'titre-section' }, 'Quoi'), zoneFiltres, recherche, el('div', { style: 'height:8px' }), zoneChoix,
    el('div', { class: 'titre-section' }, 'Combien'), zoneMesures,
    resultats);
  calculer();
}

/** Les graphiques et les pronostics pour les articles choisis. */
function resultatsGraph(g, choisis, lignes, debut, fin) {
  const sorties = [];
  if (!choisis.length) return [el('p', { class: 'aide' }, 'Aucun article choisi : coche des articles, ou change les filtres.')];
  if (!g.mesures.stock && !g.mesures.sorties && !g.mesures.entrees) return [el('p', { class: 'aide' }, 'Coche au moins « Stock », « Sorties » ou « Entrées ».')];

  // Les lignes d'historique de chaque article, puis sa courbe et ses variations
  const parArticle = new Map();
  lignes.forEach(h => { const k = h.t + '|' + h.i; if (!parArticle.has(k)) parArticle.set(k, []); parArticle.get(k).push(h); });
  const items = choisis.map(x => {
    const pts = serieArticle(x.t, x.o, parArticle.get(x.cle) || [], debut, fin);
    const vars = variations(pts).filter(v => v[0] >= debut && v[0] <= fin);
    return { ...x, nom: x.o.nom_court || x.o.nom || x.o.ref, unite: uniteGraph(x.t, x.o), pts,
      sorti: vars.filter(v => v[1] < 0).reduce((a, v) => a - v[1], 0), entre: vars.filter(v => v[1] > 0).reduce((a, v) => a + v[1], 0), vars };
  });

  // Peu de recul : on le dit (les pronostics demandent quelques semaines de comptages)
  const recul = Math.floor((Date.now() - DEBUT_HISTORIQUE) / JOUR_MS);
  if (recul < 28) sorties.push(el('p', { class: 'graph-note' },
    `Le document suit le stock depuis le 6 novembre 2026 (${recul} jours) : les courbes s'allongent à chaque comptage, et les pronostics deviennent fiables après 4 semaines environ.`));

  // Un groupe par unité (on n'additionne jamais des pièces et des mètres)
  const unites = [...new Set(items.map(x => x.unite))].sort((a, b) => (a === 'niveau') - (b === 'niveau') || a.localeCompare(b, 'fr'));
  const pas = pasEffectif(g, debut, fin);
  unites.forEach(u => {
    const groupe = items.filter(x => x.unite === u);
    const plusieurs = unites.length > 1;
    const quoi = groupe.length === 1 ? groupe[0].nom : `${groupe.length} articles`;
    if (plusieurs) sorties.push(el('div', { class: 'titre-section', style: 'margin-top:14px' }, `En ${u} · ${quoi}`));
    // Total (sauf pour les niveaux, qui ne s'additionnent pas) ou un par article (8 au plus : ceux qui bougent le plus)
    let series;
    let note = null;
    if ((g.affichage === 'total' || groupe.length === 1) && u !== 'niveau') {
      series = [{ nom: groupe.length === 1 ? groupe[0].nom : `Total (${groupe.length} articles)`, slot: 0,
        pts: groupe.length === 1 ? groupe[0].pts : serieTotale(groupe), vars: groupe.flatMap(x => x.vars) }];
    } else {
      const tries = groupe.slice().sort((a, b) => (b.sorti + b.entre) - (a.sorti + a.entre) || triFr(a.nom, b.nom));
      const gardes = tries.slice(0, MAX_COURBES).sort((a, b) => triFr(a.nom, b.nom));
      if (groupe.length > MAX_COURBES) note = `${MAX_COURBES} courbes au plus : les ${MAX_COURBES} articles qui ont le plus bougé (sur ${groupe.length}). Affine avec les filtres, ou affiche le total.`;
      if (u === 'niveau' && g.affichage === 'total' && groupe.length > 1) note = 'Les niveaux ne s\'additionnent pas : une courbe par article.' + (note ? ' ' + note : '');
      series = gardes.map((x, i) => ({ nom: x.nom, slot: i, pts: x.pts, vars: x.vars }));
    }
    if (note) sorties.push(el('p', { class: 'aide' }, note));
    const seul = groupe.length === 1 ? groupe[0] : null;
    const prono = seul ? pronostic(seul, debut, fin, g.delai) : null;
    if (g.mesures.stock) sorties.push(graphLignes({
      titre: `Stock${plusieurs ? '' : ' · ' + quoi}`, unite: u, series, debut, fin,
      seuil: seul && u !== 'niveau' && seul.t !== 'bobines' ? num(seul.o.seuil) : null,
      conseille: prono ? prono.conseille : null, parJour: prono ? prono.parJour : (series.length === 1 && u !== 'niveau' ? pronosticTotal(groupe, debut, fin) : null),
    }));
    if (u !== 'niveau') {
      if (g.mesures.sorties) sorties.push(graphBarres({ titre: `Sorties par ${pas}`, unite: u, series, signe: -1, pas, debut, fin }));
      if (g.mesures.entrees) sorties.push(graphBarres({ titre: `Entrées par ${pas}`, unite: u, series, signe: 1, pas, debut, fin }));
    }
  });

  sorties.push(tableauPronostics(g, items, debut, fin));
  return sorties;
}

// ------------------------------------------------------------------ pronostics

/** Consommation d'un article sur la période : par jour, « tient encore », seuil conseillé. */
function pronostic(x, debut, fin, delai) {
  const premier = x.pts.find(p => p[1] !== null);
  const jours = premier ? (fin - Math.max(debut, premier[0])) / JOUR_MS : 0;
  const stock = valeurGraph(x.t, x.o);
  const parJour = jours >= 1 && x.sorti > 0 ? x.sorti / jours : 0;
  const eligible = x.unite !== 'niveau' && x.t !== 'bobines';      // bobines : le seuil compte la plus longue, pas le total
  return {
    jours, stock, parJour,
    tient: parJour > 0 && stock !== null && x.unite !== 'niveau' ? stock / parJour : null,
    conseille: eligible && parJour > 0 ? Math.ceil(parJour * delai * MARGE_SEUIL) : null,
  };
}
function pronosticTotal(groupe, debut, fin) {
  const p = groupe.map(x => pronostic(x, debut, fin, 1)).filter(p => p.parJour > 0);
  return p.length ? p.reduce((a, b) => a + b.parJour, 0) : null;
}
function joursTexte(j) {
  if (j === null) return '—';
  if (j < 1) return 'moins d\'un jour';
  if (j < 60) return `${Math.round(j)} jour${Math.round(j) > 1 ? 's' : ''}`;
  return `${Math.round(j / 30)} mois`;
}
function tableauPronostics(g, items, debut, fin) {
  const delai = el('input', { type: 'number', min: '1', max: '120', value: g.delai, style: 'width:80px', onchange: () => {
    const v = Math.max(1, Math.min(120, Math.round(num(delai.value) || DELAI_DEFAUT)));
    g.delai = v; ecrireStockage('sd_delai_chercher', String(v)); principal('graphiques');
  } });
  const lignes = items.map(x => ({ x, p: pronostic(x, debut, fin, g.delai) }))
    .sort((a, b) => (a.p.tient ?? 1e9) - (b.p.tient ?? 1e9) || triFr(a.x.nom, b.x.nom)).slice(0, 150);
  const corps = el('tbody', {}, lignes.map(({ x, p }) => {
    const niv = x.unite === 'niveau';
    const unite = niv || x.unite === 'pièces' ? '' : ' ' + x.unite;
    const val = v => v === null ? '—' : niv ? niveauLibelle((niveaux()[Math.round(v)] || [])[0]) : nombreJoli(Math.round(v * 10) / 10) + unite;
    const seuil = num(x.o.seuil);
    const bouton = p.conseille !== null && p.conseille !== seuil ? el('button', { class: 'petit', onclick: async () => {
      if (!confirm(`Seuil d'alerte de « ${x.nom} » : ${seuil === null ? 'aucun' : nombreJoli(seuil)} → ${p.conseille}${unite} ?`)) return;
      try { await ecrire(x.t, x.o.id, { seuil: p.conseille }); principal('graphiques'); } catch (e) { alert(e.message); }
    } }, 'Mettre') : null;
    return el('tr', {},
      el('td', { class: 'col-nom' }, x.nom, el('div', { class: 'aide' }, x.o.ref || '')),
      el('td', { class: 'nb' }, val(p.stock)),
      el('td', { class: 'nb' }, niv ? '—' : val(x.sorti)),
      el('td', { class: 'nb' }, !niv && p.parJour > 0 ? val(p.parJour * 7) : '—'),
      el('td', { class: 'nb' }, niv ? '—' : joursTexte(p.tient)),
      el('td', { class: 'nb' }, seuil === null ? '—' : nombreJoli(seuil)),
      el('td', { class: 'nb' }, p.conseille === null ? '—' : String(p.conseille), bouton ? ' ' : null, bouton));
  }));
  return el('div', { class: 'graph-carte' },
    el('div', { class: 'graph-titre' }, 'Pronostics'),
    el('p', { class: 'aide', style: 'margin:0 0 8px' },
      'Sorties = ce qui a baissé entre deux comptages sur la période. « Tient encore » = le stock actuel divisé par la consommation moyenne. ',
      `Seuil conseillé = consommation par jour × jours avant d'aller chercher × ${nombreJoli(MARGE_SEUIL)} (une marge de moitié en plus) : de quoi tenir jusqu'au prochain passage chez le fournisseur. `,
      'Pas de seuil conseillé pour les bobines (leur seuil compte la plus longue bobine) ni pour les niveaux.'),
    el('label', { class: 'rangee', style: 'gap:8px;margin:0 0 8px' }, "Jours avant d'aller chercher (le temps d'y aller, week-end compris) :", delai),
    el('div', { class: 'graph-table-cadre' }, el('table', { class: 'graph-table' },
      el('thead', {}, el('tr', {}, ['Article', 'Stock', 'Sorties', 'Par semaine', 'Tient encore', 'Seuil', 'Seuil conseillé'].map(h => el('th', {}, h)))),
      corps)),
    items.length > 150 ? el('p', { class: 'aide' }, `(les 150 premiers sur ${items.length})`) : null);
}

// ------------------------------------------------------------------ le dessin (SVG fait main : le site ne charge rien d'ailleurs)

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...enfants) {
  const e = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) e.setAttribute(k, v); });
  enfants.flat().forEach(c => { if (c !== null && c !== undefined) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return e;
}
function largeurGraph() { return Math.max(300, Math.min(880, (document.querySelector('main') || document.body).clientWidth - 30)); }
/** Une échelle « ronde » : 0 → max en 4 ou 5 pas de 1, 2, 2,5 ou 5 × 10ⁿ. */
function graduations(max) {
  if (!(max > 0)) return [0, 1];
  const brut = max / 4, p = Math.pow(10, Math.floor(Math.log10(brut)));
  const pasG = [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= brut);
  const l = [];
  for (let v = 0; v <= max + pasG * 0.001; v += pasG) l.push(Math.round(v * 1000) / 1000);
  if (l[l.length - 1] < max) l.push(Math.round((l[l.length - 1] + pasG) * 1000) / 1000);
  return l;
}
function nombreAxe(v) { return v >= 10000 ? nombreJoli(Math.round(v / 100) / 10) + ' k' : nombreJoli(v); }
function legende(series) {
  if (series.length < 2) return null;
  return el('div', { class: 'graph-legende' }, series.map(x => el('span', {}, el('i', { style: `background:var(--serie-${x.slot + 1})` }), x.nom)));
}
function bulle() { return el('div', { class: 'graph-bulle', hidden: true }); }
function placerBulle(b, cadre, x, y) {
  const w = cadre.clientWidth;
  b.hidden = false;
  b.style.left = Math.min(Math.max(4, x + 12), w - b.offsetWidth - 4) + 'px';
  b.style.top = Math.max(4, y - b.offsetHeight - 10) + 'px';
}
function ligneBulle(slot, valeur, nom) {
  return el('div', { class: 'ligne' }, slot === null ? null : el('i', { style: `background:var(--serie-${slot + 1})` }), el('b', {}, valeur), ' ', el('span', {}, nom));
}

/** Le stock dans le temps : une ligne en escalier par courbe (la valeur tient jusqu'au comptage suivant). */
function graphLignes({ titre, unite, series, debut, fin, seuil, conseille, parJour }) {
  const W = largeurGraph(), H = 240, mg = { g: unite === 'niveau' ? 52 : 46, d: 16, h: 14, b: 28 };
  // Pronostic (une seule courbe) : la pente de consommation prolongée jusqu'à zéro (au plus la moitié de la période en plus)
  const dernier = series.length === 1 ? [...series[0].pts].reverse().find(p => p[1] !== null) : null;
  let finAxe = fin, proj = null;
  if (dernier && parJour > 0 && unite !== 'niveau') {
    const jusqu = Math.min(dernier[1] / parJour, (fin - debut) / JOUR_MS * 0.5);
    if (jusqu >= 0.5) { proj = [[fin, dernier[1]], [fin + jusqu * JOUR_MS, Math.max(0, dernier[1] - parJour * jusqu)]]; finAxe = proj[1][0]; }
  }
  const valeurs = series.flatMap(x => x.pts.map(p => p[1])).filter(v => v !== null).concat([seuil, conseille].filter(v => v !== null && v !== undefined));
  const ticks = unite === 'niveau' ? niveaux().map((n, i) => i) : graduations(Math.max(1, ...valeurs) * 1.05);
  const yMax = ticks[ticks.length - 1] || 1;
  const X = t => mg.g + (t - debut) / (finAxe - debut) * (W - mg.g - mg.d);
  const Y = v => H - mg.b - v / yMax * (H - mg.h - mg.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'graph-svg', role: 'img', 'aria-label': `${titre}, en ${unite}` });

  // Grille et axes (traits fins, discrets)
  ticks.forEach(v => {
    svg.append(s('line', { x1: mg.g, x2: W - mg.d, y1: Y(v), y2: Y(v), class: 'g-grille' }));
    svg.append(s('text', { x: mg.g - 6, y: Y(v) + 4, class: 'g-axe', 'text-anchor': 'end' }, unite === 'niveau' ? niveauLibelle(niveaux()[v][0]) : nombreAxe(v)));
  });
  const nbDates = Math.max(2, Math.min(6, Math.floor((W - mg.g) / 90)));
  for (let i = 0; i < nbDates; i++) {
    const t = debut + (fin - debut) * i / (nbDates - 1);
    svg.append(s('text', { x: X(t), y: H - 8, class: 'g-axe', 'text-anchor': i === 0 ? 'start' : i === nbDates - 1 ? 'end' : 'middle' }, fmtJour.format(new Date(t))));
  }
  if (proj) svg.append(s('line', { x1: X(fin), x2: X(fin), y1: mg.h, y2: H - mg.b, class: 'g-maintenant' }));

  // Seuils : pointillés (une limite, pas des données)
  const traitSeuil = (v, lib, classe) => {
    if (v === null || v === undefined || v > yMax) return;
    svg.append(s('line', { x1: mg.g, x2: W - mg.d, y1: Y(v), y2: Y(v), class: classe }));
    svg.append(s('text', { x: mg.g + 4, y: Y(v) - 4, class: 'g-etiquette' }, lib));
  };
  traitSeuil(seuil, `seuil ${nombreJoli(seuil)}`, 'g-seuil');
  if (conseille !== seuil) traitSeuil(conseille, `seuil conseillé ${conseille}`, 'g-conseille');

  // Les courbes en escalier (coupées là où l'article n'était pas compté)
  series.forEach(x => {
    let d = '', aire = '', ouvert = false, xDebut = 0, prec = null;
    x.pts.forEach((p, i) => {
      const suiv = x.pts[i + 1];
      if (p[1] === null) { if (ouvert) { aire += `L${X(p[0])},${Y(0)}L${xDebut},${Y(0)}Z`; } ouvert = false; prec = null; return; }
      if (!ouvert) { d += `M${X(p[0])},${Y(p[1])}`; aire += `M${X(p[0])},${Y(0)}L${X(p[0])},${Y(p[1])}`; xDebut = X(p[0]); ouvert = true; }
      else { d += `V${Y(p[1])}`; aire += `V${Y(p[1])}`; }
      const xs = X(suiv ? suiv[0] : p[0]);
      d += `H${xs}`; aire += `H${xs}`;
      if (!suiv) aire += `V${Y(0)}H${xDebut}Z`;
      prec = p;
    });
    if (series.length === 1 && aire) svg.append(s('path', { d: aire, class: 'g-aire', style: `fill:var(--serie-${x.slot + 1})` }));
    if (d) svg.append(s('path', { d, class: 'g-ligne', style: `stroke:var(--serie-${x.slot + 1})` }));
    const fin1 = [...x.pts].reverse().find(p => p[1] !== null);
    if (fin1) svg.append(s('circle', { cx: X(fin1[0]), cy: Y(fin1[1]), r: 4.5, class: 'g-point', style: `fill:var(--serie-${x.slot + 1})` }));
  });
  if (proj) {
    svg.append(s('path', { d: `M${X(proj[0][0])},${Y(proj[0][1])}L${X(proj[1][0])},${Y(proj[1][1])}`, class: 'g-projection', style: `stroke:var(--serie-${series[0].slot + 1})` }));
    svg.append(s('text', { x: X(proj[1][0]) - 2, y: Math.max(mg.h + 10, Y(proj[1][1]) - 8), class: 'g-etiquette', 'text-anchor': 'end' },
      `pronostic → ${nombreJoli(Math.round(proj[1][1] * 10) / 10)} le ${fmtJour.format(new Date(proj[1][0]))}`));
  }

  // Une seule courbe : sa valeur actuelle au bout (les autres valeurs : la bulle et « Voir les chiffres »)
  if (series.length === 1) {
    const f = [...series[0].pts].reverse().find(p => p[1] !== null);
    if (f) svg.append(s('text', { x: X(f[0]) - 8, y: Y(f[1]) - 9, class: 'g-valeur', 'text-anchor': 'end' }, unite === 'niveau' ? niveauLibelle(niveaux()[f[1]][0]) : nombreJoli(Math.round(f[1] * 10) / 10)));
  }

  // Survol : un trait vertical suit le doigt et se cale sur le comptage le plus proche ; la bulle donne toutes les courbes
  const temps = [...new Set(series.flatMap(x => x.pts.map(p => p[0])))].sort((a, b) => a - b);
  const curseur = s('line', { y1: mg.h, y2: H - mg.b, class: 'g-curseur', visibility: 'hidden' });
  const zone = s('rect', { x: mg.g, y: mg.h, width: W - mg.g - mg.d, height: H - mg.h - mg.b, fill: 'transparent' });
  svg.append(curseur, zone);
  const b = bulle();
  const cadre = el('div', { class: 'graph-cadre' }, svg, b);
  const montrer = ev => {
    const r = svg.getBoundingClientRect();
    const xv = (ev.clientX - r.left) * W / r.width;
    const t = debut + (xv - mg.g) / (W - mg.g - mg.d) * (finAxe - debut);
    const proche = temps.reduce((a, c) => Math.abs(c - t) < Math.abs(a - t) ? c : a, temps[0]);
    if (proche === undefined) return;
    curseur.setAttribute('x1', X(proche)); curseur.setAttribute('x2', X(proche)); curseur.setAttribute('visibility', 'visible');
    vider(b).append(el('div', { class: 'quand' }, jourHeure(new Date(proche).toISOString())),
      ...series.map(x => { const v = valeurA(x.pts, proche); return ligneBulle(series.length > 1 ? x.slot : null, v === null ? 'pas compté' : unite === 'niveau' ? niveauLibelle(niveaux()[v][0]) : `${nombreJoli(Math.round(v * 10) / 10)} ${unite}`, series.length > 1 ? x.nom : ''); }));
    placerBulle(b, cadre, X(proche) * r.width / W, (ev.clientY - r.top));
  };
  zone.addEventListener('pointermove', montrer);
  zone.addEventListener('pointerdown', montrer);
  zone.addEventListener('pointerleave', () => { b.hidden = true; curseur.setAttribute('visibility', 'hidden'); });

  // La même chose en chiffres
  const tableau = el('table', { class: 'graph-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Quand'), series.map(x => el('th', {}, x.nom)))),
    el('tbody', {}, temps.slice().reverse().map(t => el('tr', {}, el('td', {}, jourHeure(new Date(t).toISOString())),
      series.map(x => { const v = valeurA(x.pts, t); return el('td', { class: 'nb' }, v === null ? '—' : unite === 'niveau' ? niveauLibelle(niveaux()[v][0]) : nombreJoli(Math.round(v * 10) / 10)); })))));
  return el('div', { class: 'graph-carte' },
    el('div', { class: 'graph-titre' }, titre, el('span', { class: 'aide' }, unite === 'niveau' ? '  niveau du carton ouvert' : `  en ${unite}`)),
    legende(series), cadre,
    el('details', { class: 'graph-chiffres' }, el('summary', {}, 'Voir les chiffres'), el('div', { class: 'graph-table-cadre' }, tableau)));
}

/** Sorties (ou entrées) par jour / semaine / mois : des barres, empilées par article quand il y en a plusieurs. */
function graphBarres({ titre, unite, series, signe, pas, debut, fin }) {
  const cases = [];
  for (let t = debutCase(debut, pas); t <= fin; t = caseSuivante(t, pas)) cases.push(t);
  const idx = t => { let i = cases.length - 1; while (i > 0 && cases[i] > t) i--; return i; };
  const val = series.map(x => { const l = cases.map(() => 0); x.vars.forEach(([t, d]) => { if (t >= debut && t <= fin && Math.sign(d) === signe) l[idx(t)] += Math.abs(d); }); return l; });
  const totaux = cases.map((_, i) => val.reduce((a, l) => a + l[i], 0));
  const total = totaux.reduce((a, v) => a + v, 0);
  const W = largeurGraph(), H = 200, mg = { g: 46, d: 12, h: 14, b: 28 };
  const ticks = graduations(Math.max(1, ...totaux) * 1.05), yMax = ticks[ticks.length - 1];
  const bande = (W - mg.g - mg.d) / cases.length;
  const larg = Math.max(2, Math.min(24, bande * 0.7));
  const Y = v => H - mg.b - v / yMax * (H - mg.h - mg.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'graph-svg', role: 'img', 'aria-label': `${titre}, en ${unite}` });
  ticks.forEach(v => {
    svg.append(s('line', { x1: mg.g, x2: W - mg.d, y1: Y(v), y2: Y(v), class: 'g-grille' }));
    svg.append(s('text', { x: mg.g - 6, y: Y(v) + 4, class: 'g-axe', 'text-anchor': 'end' }, nombreAxe(v)));
  });
  const tousLes = Math.max(1, Math.ceil(cases.length / Math.max(2, Math.floor((W - mg.g) / 70))));
  const b = bulle();
  const cadre = el('div', { class: 'graph-cadre' }, svg, b);
  cases.forEach((t, i) => {
    const cx = mg.g + bande * (i + 0.5);
    if (i % tousLes === 0) svg.append(s('text', { x: cx, y: H - 8, class: 'g-axe', 'text-anchor': 'middle' }, pas === 'mois' ? fmtMois.format(new Date(t)) : fmtJour.format(new Date(t))));
    // Les morceaux empilés, séparés par 2 px de fond ; seul le haut est arrondi
    let base = 0;
    const morceaux = series.map((x, k) => ({ k, v: val[k][i] })).filter(m => m.v > 0);
    const groupe = s('g', { class: 'g-barre' });
    morceaux.forEach((m, j) => {
      const y0 = Y(base), y1 = Y(base + m.v);
      const haut = j === morceaux.length - 1;
      const h = Math.max(1, y0 - y1 - (j > 0 ? 2 : 0));
      const yb = y0 - (j > 0 ? 2 : 0);
      const x0 = cx - larg / 2, r = haut ? Math.min(4, h, larg / 2) : 0;
      groupe.append(s('path', { d: `M${x0},${yb}V${yb - h + r}Q${x0},${yb - h} ${x0 + r},${yb - h}H${x0 + larg - r}Q${x0 + larg},${yb - h} ${x0 + larg},${yb - h + r}V${yb}Z`,
        style: `fill:var(--serie-${series[m.k].slot + 1})` }));
      base += m.v;
    });
    // La zone de survol est toute la bande (plus grande que la barre)
    const cible = s('rect', { x: mg.g + bande * i, y: mg.h, width: bande, height: H - mg.h - mg.b, fill: 'transparent' });
    const montrer = ev => {
      const r = svg.getBoundingClientRect();
      groupe.classList.add('survol');
      vider(b).append(el('div', { class: 'quand' }, libelleCase(t, pas)),
        series.length > 1 ? ligneBulle(null, `${nombreJoli(Math.round(totaux[i] * 10) / 10)} ${unite}`, 'en tout') : null,
        ...series.map((x, k) => ligneBulle(series.length > 1 ? x.slot : null, `${nombreJoli(Math.round(val[k][i] * 10) / 10)}${series.length > 1 ? '' : ' ' + unite}`, series.length > 1 ? x.nom : '')));
      placerBulle(b, cadre, cx * r.width / W, ev.clientY - r.top);
    };
    cible.addEventListener('pointermove', montrer);
    cible.addEventListener('pointerdown', montrer);
    cible.addEventListener('pointerleave', () => { b.hidden = true; groupe.classList.remove('survol'); });
    svg.append(groupe, cible);
  });
  const tableau = el('table', { class: 'graph-table' },
    el('thead', {}, el('tr', {}, el('th', {}, pas === 'mois' ? 'Mois' : pas === 'semaine' ? 'Semaine' : 'Jour'),
      series.length > 1 ? [series.map(x => el('th', {}, x.nom)), el('th', {}, 'En tout')] : el('th', {}, unite))),
    el('tbody', {}, cases.map((t, i) => ({ t, i })).reverse().map(({ t, i }) => el('tr', {}, el('td', {}, libelleCase(t, pas)),
      series.length > 1 ? [series.map((x, k) => el('td', { class: 'nb' }, nombreJoli(Math.round(val[k][i] * 10) / 10))), el('td', { class: 'nb' }, nombreJoli(Math.round(totaux[i] * 10) / 10))]
        : el('td', { class: 'nb' }, nombreJoli(Math.round(totaux[i] * 10) / 10))))));
  return el('div', { class: 'graph-carte' },
    el('div', { class: 'graph-titre' }, titre, el('span', { class: 'aide' }, `  en ${unite} · ${nombreJoli(Math.round(total * 10) / 10)} sur la période`)),
    legende(series), cadre,
    total === 0 ? el('p', { class: 'aide', style: 'margin:4px 0 0' }, signe < 0 ? 'Aucune baisse entre deux comptages sur la période.' : 'Aucune hausse entre deux comptages sur la période.') : null,
    el('details', { class: 'graph-chiffres' }, el('summary', {}, 'Voir les chiffres'), el('div', { class: 'graph-table-cadre' }, tableau)));
}
