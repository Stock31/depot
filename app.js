/*
 * Stock Dépôt — le site des patrons (Sanji, 11/11/2026).
 *
 * Ce fichier ne contient aucune donnée ni aucun secret : il parle directement au document (Supabase), comme l'appli.
 * La clé ci-dessous est la clé PUBLIQUE de l'appli (faite pour être visible) ; elle ne permet rien sans compte :
 *  1. le navigateur se connecte à un compte (identifiant + mot de passe, créés depuis l'appli, provisoire à changer) ;
 *  2. la première fois sur cet appareil, on tape le code magasinier (comme sur un téléphone) ;
 *  3. l'appareil est retenu (jeton secret gardé dans ce navigateur) jusqu'à « Se déconnecter ».
 * Tout ce qui est écrit est signé du nom du compte, par la base elle-même.
 */
'use strict';

const CONFIG = {
  url: 'https://phrdduaciipoxvodfzth.supabase.co',
  cle: 'sb_publishable_On7Xm61ra2aDalj1RiBzeg_gWJYdXAg',
};
// carnet : la liste des fournisseurs, pour « Modifier l'article » (⚙)
const TABLES = ['accessoires', 'bobines', 'descentes', 'zones', 'reglages', 'kits', 'demandes', 'carnet'];
const ARTICLES = ['accessoires', 'bobines', 'descentes'];

// ------------------------------------------------------------------ petits outils

/** Crée un élément ; les textes passent toujours par textContent (jamais de HTML venu du document). */
function el(tag, props, ...enfants) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'open') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of enfants.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
function vider(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
/** Ajoute des enfants en sautant les « rien » (null, false) : append() les écrirait en toutes lettres. */
function ajouterA(parent, ...enfants) { parent.append(...enfants.flat().filter(c => c !== null && c !== undefined && c !== false)); return parent; }
function hex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
function nombreJoli(d) { if (d === null || d === undefined || isNaN(d)) return '?'; return Number.isInteger(d) ? String(d) : String(+d.toFixed(2)).replace('.', ','); }
function num(v) { return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v); }
const fmtJour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const fmtJourAn = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
function jour(iso) { return iso ? fmtJour.format(new Date(iso)) : '?'; }
function jourHeure(iso) { return iso ? `${fmtJour.format(new Date(iso))} à ${fmtHeure.format(new Date(iso))}` : '?'; }
function normaliser(s) { return (s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase(); }

// ------------------------------------------------------------------ l'appareil (ce navigateur) et le document

function lireStockage(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function ecrireStockage(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* navigation privée */ } }

const APP = (() => {
  let id = lireStockage('sd_appareil'), jeton = lireStockage('sd_jeton');
  if (!id || !jeton || jeton.length < 32) {
    id = 'WEB-' + hex(5).toUpperCase();
    jeton = hex(32);
    ecrireStockage('sd_appareil', id); ecrireStockage('sd_jeton', jeton);
  }
  return { id, jeton };
})();

function modeleAppareil() {
  const ua = navigator.userAgent;
  const quoi = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'PC Windows' : /Mac/.test(ua) ? 'Mac' : 'Navigateur';
  return `Site · ${quoi}`;
}

async function rpc(nom, corps) {
  const r = await fetch(`${CONFIG.url}/rest/v1/rpc/${nom}`, {
    method: 'POST',
    headers: { apikey: CONFIG.cle, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(corps),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Le document répond ${r.status} : ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : null;
}
const moi = () => ({ p_appareil: APP.id, p_jeton: APP.jeton });

const etat = { identifiant: null, onglet: 'stock', donnees: {}, filtre: 'tous', recherche: '', ouverts: new Set(), coches: new Map(), fenetre: null };

async function chargerTout() {
  const res = await Promise.all(TABLES.map(t => rpc('lire_prive', { ...moi(), p_table: t, p_depuis: null })));
  res.forEach((r, i) => {
    if (!r || !r.ok) throw new Error(r && r.message || 'Lecture impossible');
    etat.donnees[TABLES[i]] = r.lignes || [];
  });
  etat.charge = new Date();
}

async function ecrire(table, id, champs) {
  const r = await rpc('appliquer_modifications', {
    modifs: [{ table, id, champs, ts: new Date().toISOString(), par: etat.identifiant, appareil: APP.id }],
    p_jeton: APP.jeton,
  });
  const res = r && r.resultats && r.resultats[0];
  if (!res) throw new Error('Pas de réponse du document');
  if (res.erreur) throw new Error(res.erreur);
  // Copie locale à jour tout de suite (la prochaine lecture confirmera)
  const liste = etat.donnees[table] || (etat.donnees[table] = []);
  let o = liste.find(x => x.id === id);
  if (!o) { o = { id }; liste.push(o); }
  Object.assign(o, champs);
}

// ------------------------------------------------------------------ règles (les mêmes que l'appli)

const tous = t => (etat.donnees[t] || []).filter(o => !o.supprime);
function reglage(id) { const r = (etat.donnees.reglages || []).find(x => x.id === id && !x.supprime); return r ? r.valeur : null; }
function niveaux() {
  const r = reglage('niveaux');
  const l = Array.isArray(r) ? r.filter(o => o && o.valeur).map(o => [o.valeur, o.libelle || o.valeur]) : [];
  return l.length ? l : [['vide', '0/3'], ['bas', '1/3'], ['moyen', '2/3'], ['plein', '3/3']];
}
const niveauLibelle = v => (niveaux().find(n => n[0] === v) || [v, v || '?'])[1];
function niveauxAlerte() { const r = reglage('niveaux_alerte'); return new Set(Array.isArray(r) ? r : ['bas', 'vide']); }
function seuilDe(o) { return num(o.seuil) ?? num(reglage('seuil_par_defaut')) ?? 0; }
function longueurTuyau() { return num(reglage('longueur_tuyau_m')) ?? 3; }
function metresDescente(o) {
  const c = num(o.cartons), t = num(o.tuyaux);
  if (c === null && t === null) return null;
  return ((c ?? 0) * (num(o.par_carton) ?? 0) + (t ?? 0)) * longueurTuyau();
}
const metres = o => Array.isArray(o.metres) ? o.metres.map(Number).filter(x => !isNaN(x)) : [];
const sorties = o => Array.isArray(o.sorties) ? o.sorties : [];

function statut(tab, o) {
  if (o.supprime) return 'CORBEILLE';
  if (o.manque) return 'MANQUE';          // il a manqué pour un kit : rouge vif, avant tout le reste
  if (tab === 'accessoires' && o.suivi === false) return 'DECIDER';
  const seuil = seuilDe(o);
  let alerte = null;
  if (tab === 'bobines') { const m = metres(o); alerte = (m.length === 0 && !o.compte) ? null : !m.some(x => x >= seuil); }
  else if (tab === 'descentes') { const m = metresDescente(o); alerte = m === null ? null : m <= seuil; }
  else {
    const q = num(o.quantite), niv = o.niveau;
    const mode = o.mode || 'quantite';
    if (mode === 'niveau') alerte = niv ? niveauxAlerte().has(niv) : null;
    else if (mode === 'mixte') alerte = (q === null || !niv) ? null : (q <= seuil && niveauxAlerte().has(niv));
    else alerte = q === null ? null : q <= seuil;
  }
  if (alerte === null) return 'COMPTER';
  if (!alerte) return 'OK';
  if (o.signaler === false) return 'OK';
  return o.alerte_vue ? 'VUE' : 'SIGNALER';
}
const LIBELLES = { MANQUE: 'Manque !', SIGNALER: 'À signaler', VUE: 'Vu', COMPTER: 'À compter', OK: 'OK', DECIDER: 'À décider', CORBEILLE: 'Corbeille' };
const enAlerte = s => s === 'MANQUE' || s === 'SIGNALER' || s === 'VUE';

/** Ce qu'on peut prendre maintenant (null = on ne sait pas : compté au niveau, ou jamais compté). */
function disponible(t, o, u) {
  if (t === 'bobines') return metres(o).length;
  if (t === 'descentes') return num(o[u || 'tuyaux']);
  if ((o.mode || 'quantite') === 'niveau') return null;
  return num(o.quantite);
}
function texteManque(o) {
  const m = o.manque;
  if (!m) return null;
  return `Il a manqué ${m.n ? nombreJoli(num(m.n)) + ' ' : ''}pour un kit, le ${jourHeure(m.quand)}${m.par ? ' (' + m.par + ')' : ''}`;
}

function valeurCourte(tab, o) {
  if (tab === 'bobines') {
    const m = metres(o), s = sorties(o).length;
    const b = m.length ? `${m.length} bob. · ${nombreJoli(m.reduce((a, x) => a + x, 0))} ml` : null;
    return s ? `${b || '0 bob.'} · ${s} sortie${s > 1 ? 's' : ''}` : b;
  }
  if (tab === 'descentes') { const m = metresDescente(o); return m === null ? null : `${nombreJoli(m)} ml`; }
  const q = num(o.quantite), niv = o.niveau;
  switch (o.mode || 'quantite') {
    case 'niveau': return niv ? niveauLibelle(niv) : null;
    case 'mixte': return (q === null && !niv) ? null : `${q === null ? '?' : nombreJoli(q)} + ${niv ? niveauLibelle(niv) : '?'}`;
    default: return q === null ? null : nombreJoli(q) + (o.unite ? ' ' + o.unite : '');
  }
}

function resume(tab, o) {
  if (tab === 'bobines') {
    const m = metres(o);
    return m.length ? `${m.length} bobine${m.length > 1 ? 's' : ''} : ${m.map(nombreJoli).join(' + ')} = ${nombreJoli(m.reduce((a, x) => a + x, 0))} ml` : null;
  }
  if (tab === 'descentes') {
    const tot = metresDescente(o);
    return tot === null ? null : `${nombreJoli(num(o.cartons) ?? 0)} carton(s) + ${nombreJoli(num(o.tuyaux) ?? 0)} tuyau(x) = ${nombreJoli(tot)} ml`;
  }
  const q = num(o.quantite), niv = o.niveau;
  switch (o.mode || 'quantite') {
    case 'niveau': return niv ? `Niveau ${niveauLibelle(niv)}` : null;
    case 'mixte': return (q === null && !niv) ? null : `${q === null ? '?' : nombreJoli(q)} fermé(s), ouvert ${niv ? niveauLibelle(niv) : '?'}`;
    default: return q === null ? null : nombreJoli(q) + (o.unite ? ' ' + o.unite : '');
  }
}

function mouvementTexte(m) {
  if (!m) return null;
  const qui = m.ouvrier ? ` (${m.ouvrier})` : '';
  const unite = m.unite ? ' ' + m.unite : '';
  const n = nombreJoli(num(m.n)), mm = nombreJoli(num(m.m));
  switch (m.type) {
    case 'entree': return `Entrée +${n}${unite}${qui}`;
    case 'sortie': return `Sortie −${n}${unite}${qui}`;
    case 'bobine_sortie': return `Bobine de ${mm} ml sortie${qui}`;
    case 'bobine_retour': return (num(m.retour) || 0) <= 0 ? `Bobine de ${mm} ml finie${qui}` : `Bobine ramenée : ${nombreJoli(num(m.retour))} ml sur ${mm} ml${qui}`;
    case 'bobine_neuve': return `Bobine neuve de ${mm} ml`;
    case 'kit': return m.bobines ? `Parti dans un kit : ${n} bobine(s) (${mm} ml)` : `Parti dans un kit : −${n}${unite}`;
    case 'kit_retour': return `Revenu d'un kit : +${n}${unite}`;
    default: return m.type || 'Mouvement';
  }
}

/** Les zones rangées comme le dépôt : entrepôt → zones (groupes sur plusieurs niveaux) → rayons. */
function arbreZones() {
  const zones = tous('zones');
  const ids = new Set(zones.map(z => z.id));
  const ordre = z => num(z.ordre) ?? 1e9;
  const enfants = (parent, ent) => zones.filter(z => {
    const p = z.parent && ids.has(z.parent) ? z.parent : null;
    return p === parent && (parent !== null || (num(z.entrepot) ?? 1) === ent);
  }).sort((a, b) => ordre(a) - ordre(b));
  const noeud = (z, ent) => z.est_groupe ? { zone: z, enfants: enfants(z.id, ent).map(x => noeud(x, ent)) } : { zone: z, enfants: [] };
  const entrepots = [...new Set(zones.map(z => num(z.entrepot) ?? 1))].sort();
  return entrepots.map(ent => ({ entrepot: ent, enfants: enfants(null, ent).map(z => noeud(z, ent)) }));
}

/** Les articles d'un rayon, dans l'ordre du dépôt. */
function articlesDuRayon(code) {
  const res = [];
  for (const t of ARTICLES) {
    tous(t).filter(o => o.zone === code && (t !== 'accessoires' || o.suivi !== false))
      .sort((a, b) => (num(a.g_ordre) ?? 1e9) - (num(b.g_ordre) ?? 1e9) || (num(a.ordre) ?? 1e9) - (num(b.ordre) ?? 1e9) || (a.nom || '').localeCompare(b.nom || ''))
      .forEach(o => res.push({ t, o }));
  }
  return res;
}
function trouver(t, id) { return (etat.donnees[t] || []).find(o => o.id === id); }

// ------------------------------------------------------------------ écrans de connexion

const app = document.getElementById('app');

function ecranAttente(texte) { vider(app).append(el('p', { class: 'attente' }, texte || 'Chargement…')); }

function ecranErreur(err) {
  vider(app).append(el('div', { class: 'connexion' },
    el('h1', {}, 'Stock Dépôt'),
    el('p', { class: 'erreur' }, String(err && err.message || err)),
    el('button', { class: 'principal', onclick: demarrer }, 'Réessayer')));
}

function ecranConnexion(message) {
  const ident = el('input', { type: 'text', autocomplete: 'username', autocapitalize: 'words', id: 'ident' });
  const mdp = el('input', { type: 'password', autocomplete: 'current-password', id: 'mdp' });
  const msg = el('p', { class: 'erreur' }, message || '');
  const bouton = el('button', { class: 'principal', type: 'submit' }, 'Se connecter');
  const form = el('form', {
    onsubmit: async ev => {
      ev.preventDefault();
      bouton.disabled = true; msg.textContent = '';
      try {
        const r = await rpc('connecter_compte', { ...moi(), p_identifiant: ident.value.trim(), p_mdp: mdp.value, p_modele: modeleAppareil() });
        if (!r.ok) { msg.textContent = r.message; bouton.disabled = false; return; }
        await demarrer();
      } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
    },
  },
    el('label', { for: 'ident' }, 'Identifiant (ton prénom)'), ident,
    el('label', { for: 'mdp' }, 'Mot de passe'), mdp,
    msg, bouton);
  vider(app).append(el('div', { class: 'connexion carte' },
    el('h1', {}, 'Stock Dépôt'),
    el('p', { class: 'aide' }, 'Connecte-toi avec le compte que Yannick t\'a créé. Cet appareil s\'en souviendra.'),
    form));
  ident.focus();
}

function ecranChangement(obligatoire) {
  const ancien = el('input', { type: 'password', autocomplete: 'current-password', id: 'ancien' });
  const nouveau = el('input', { type: 'password', autocomplete: 'new-password', id: 'nouveau' });
  const encore = el('input', { type: 'password', autocomplete: 'new-password', id: 'encore' });
  const ident = el('input', { type: 'text', value: etat.identifiant || '', autocapitalize: 'words', id: 'ident2' });
  const msg = el('p', { class: 'erreur' });
  const bouton = el('button', { class: 'principal', type: 'submit' }, 'Enregistrer');
  const form = el('form', {
    onsubmit: async ev => {
      ev.preventDefault();
      msg.textContent = '';
      if (nouveau.value !== encore.value) { msg.textContent = 'Les deux nouveaux mots de passe ne sont pas pareils.'; return; }
      bouton.disabled = true;
      try {
        const r = await rpc('changer_mon_compte', { ...moi(), p_ancien: ancien.value, p_nouveau: nouveau.value, p_identifiant: ident.value.trim() });
        if (!r.ok) { msg.textContent = r.message; bouton.disabled = false; return; }
        etat.identifiant = r.identifiant;
        await demarrer();
      } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
    },
  },
    el('label', { for: 'ancien' }, obligatoire ? 'Mot de passe provisoire (celui qu\'on t\'a donné)' : 'Mot de passe actuel'), ancien,
    el('label', { for: 'nouveau' }, 'Nouveau mot de passe (8 caractères au moins)'), nouveau,
    el('label', { for: 'encore' }, 'Nouveau mot de passe, encore une fois'), encore,
    el('label', { for: 'ident2' }, 'Ton identifiant (tu peux le changer)'), ident,
    msg, bouton,
    obligatoire ? null : el('button', { class: 'second', type: 'button', style: 'width:100%;margin-top:8px', onclick: () => principal(etat.onglet) }, 'Annuler'));
  vider(app).append(el('div', { class: 'connexion carte' },
    el('h1', {}, obligatoire ? 'Choisis ton mot de passe' : 'Mon compte'),
    obligatoire ? el('p', { class: 'aide' }, 'Le mot de passe qu\'on t\'a donné est provisoire : choisis le tien. Personne d\'autre ne pourra le lire.') : null,
    form));
  ancien.focus();
}

function ecranCode() {
  const code = el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', id: 'code' });
  const msg = el('p', { class: 'erreur' });
  const bouton = el('button', { class: 'principal', type: 'submit' }, 'Autoriser cet appareil');
  const form = el('form', {
    onsubmit: async ev => {
      ev.preventDefault();
      bouton.disabled = true; msg.textContent = '';
      try {
        const r = await rpc('autoriser_appareil', { p_id: APP.id, p_code: code.value, p_jeton: APP.jeton });
        if (!r.autorise) { msg.textContent = r.message; bouton.disabled = false; return; }
        await demarrer();
      } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
    },
  }, el('label', { for: 'code' }, 'Code magasinier'), code, msg, bouton);
  vider(app).append(el('div', { class: 'connexion carte' },
    el('h1', {}, 'Nouvel appareil'),
    el('p', { class: 'aide' }, `Bonjour ${etat.identifiant || ''} ! C'est la première fois sur cet appareil : tape le code magasinier (une seule fois).`),
    form,
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: seDeconnecter }, 'Se déconnecter')));
  code.focus();
}

async function seDeconnecter() {
  try { await rpc('deconnecter', moi()); } catch (e) { /* on se déconnecte quand même ici */ }
  etat.identifiant = null; etat.donnees = {};
  ecranConnexion('Tu es déconnecté.');
}

async function demarrer() {
  ecranAttente();
  try {
    const e = await rpc('etat_navigateur', moi());
    if (!e.connecte) return ecranConnexion();
    etat.identifiant = e.identifiant;
    if (e.a_changer) return ecranChangement(true);
    if (!e.autorise) return ecranCode();
    // Rappel du mot de passe (Sanji : « une question à la première connexion, pour ne pas l'oublier ; s'ils ne veulent pas, ils refusent »)
    const rappel = lireStockage('sd_rappel');
    if (!rappel) return ecranQuestionRappel();
    // Sanji : « plutôt une fois par trimestre » → tous les 3 mois (91 jours)
    if (rappel === 'oui' && Date.now() - Number(lireStockage('sd_rappel_le') || 0) > 91 * 24 * 3600 * 1000) return ecranRappel();
    await chargerTout();
    principal(etat.onglet);
  } catch (err) { ecranErreur(err); }
}

/** Une seule fois par appareil : veut-on qu'on redemande le mot de passe tous les 3 mois, pour ne pas l'oublier ? */
function ecranQuestionRappel() {
  const choisir = v => { ecrireStockage('sd_rappel', v); ecrireStockage('sd_rappel_le', String(Date.now())); demarrer(); };
  vider(app).append(el('div', { class: 'connexion carte' },
    el('h1', {}, 'Une petite question'),
    el('p', {}, 'Cet appareil se souvient de toi : tu n\'auras plus à taper ton mot de passe. Du coup, on l\'oublie vite…'),
    el('p', {}, 'Veux-tu qu\'on te le redemande tous les 3 mois, juste pour ne pas l\'oublier ?'),
    el('button', { class: 'principal', onclick: () => choisir('oui') }, 'Oui, tous les 3 mois'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => choisir('non') }, 'Non merci')));
}

/** Le rappel trimestriel : on retape son mot de passe (rien ne se bloque si on l'a oublié : on demande un provisoire à Yannick). */
function ecranRappel() {
  const mdp = el('input', { type: 'password', autocomplete: 'current-password', id: 'rappel' });
  const msg = el('p', { class: 'erreur' });
  const bouton = el('button', { class: 'principal', type: 'submit' }, 'Valider');
  const form = el('form', {
    onsubmit: async ev => {
      ev.preventDefault();
      bouton.disabled = true; msg.textContent = '';
      try {
        const r = await rpc('connecter_compte', { ...moi(), p_identifiant: etat.identifiant, p_mdp: mdp.value, p_modele: modeleAppareil() });
        if (!r.ok) { msg.textContent = r.message; bouton.disabled = false; return; }
        ecrireStockage('sd_rappel_le', String(Date.now()));
        await demarrer();
      } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
    },
  }, el('label', { for: 'rappel' }, 'Ton mot de passe'), mdp, msg, bouton);
  vider(app).append(el('div', { class: 'connexion carte' },
    el('h1', {}, 'Petit rappel'),
    el('p', { class: 'aide' }, `Bonjour ${etat.identifiant || ''} ! Comme convenu, retape ton mot de passe pour ne pas l'oublier.`),
    form,
    el('p', { class: 'aide', style: 'margin-top:14px' }, 'Oublié ? Demande à Yannick un mot de passe provisoire.'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => { ecrireStockage('sd_rappel_le', String(Date.now())); demarrer(); } }, 'Plus tard'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => { ecrireStockage('sd_rappel', 'non'); demarrer(); } }, 'Ne plus me le demander')));
  mdp.focus();
}

// ------------------------------------------------------------------ l'écran principal

// Sanji, 11/11 : « À signaler » devient ⚠ (avec le nombre), pour gagner de la place
// Les réglages (comptes, type d'affichage du stock, déconnexion) s'ouvrent par la roue ⚙ de l'en-tête,
// à côté de la synchro, comme dans l'appli (Sanji, 11/11) : ce n'est plus un onglet
const ONGLETS = [['stock', 'Stock'], ['signaler', '⚠'], ['kits', 'Kits'], ['idees', '✎ Idées']];

function principal(onglet) {
  etat.onglet = onglet || 'stock';
  const nKits = tous('kits').filter(k => !k.pret).length;
  const nSig = ARTICLES.reduce((a, t) => a + tous(t).filter(o => ['SIGNALER', 'MANQUE'].includes(statut(t, o))).length, 0);
  // Sanji, 11/11 : le ⚠ en rouge → pastille rouge vif (comme « manque »), lisible sur l'en-tête bleu, de jour comme de nuit.
  // « ︎ » force le dessin du ⚠ en caractère simple : sans lui, l'iPhone le dessine en émoji jaune.
  const nav = el('nav', { class: 'onglets' }, ONGLETS.map(([k, lib]) => el('button', {
    class: (k === etat.onglet ? 'actif ' : '') + k, onclick: () => principal(k),
  }, k === 'signaler'
    ? el('span', { class: 'alerte' }, '⚠︎' + (nSig ? ` ${nSig}` : ''))
    : lib + (k === 'kits' && nKits ? ` (${nKits})` : ''))));
  const corps = el('main');
  // En-tête comme l'appli (Sanji, 11/11) : le titre et le prénom dessous ; à droite Scan et la synchro, même taille,
  // l'icône en grand et le mot en petit ; l'heure de la dernière lecture est dans le bouton de synchro.
  // La roue ⚙ ouvre les Réglages (« Déconnexion » est en bas).
  vider(app).append(
    el('header', {},
      el('div', { class: 'ligne1' },
        el('div', { class: 'titre' }, el('h1', {}, 'Stock Dépôt'), el('div', { class: 'qui' }, etat.identifiant || '?')),
        el('button', { class: 'tuile', title: 'Scanner une étiquette', onclick: () => scanner(code => ouvrirArticleScanne(code)) },
          el('span', { class: 'icone' }, '▣'), el('span', {}, 'Scan')),
        el('button', { class: 'tuile', title: 'Relire le document', onclick: rafraichir },
          el('span', { class: 'icone' }, '⟳'), el('span', {}, `synchro ${etat.charge ? fmtHeure.format(etat.charge) : '—'}`)),
        el('button', { class: 'reglages' + (etat.onglet === 'comptes' ? ' actif' : ''), title: 'Réglages', 'aria-label': 'Réglages',
          onclick: () => principal('comptes') }, '⚙︎')),
      nav),
    corps);
  ({ stock: pageStock, signaler: pageSignaler, kits: pageKits, idees: pageIdees, comptes: pageComptes })[etat.onglet](corps);
}

async function rafraichir() {
  try { await chargerTout(); principal(etat.onglet); }
  catch (e) { if (/autoris/i.test(e.message)) demarrer(); else alert(e.message); }
}

// Relecture toutes les 2 minutes quand la page est à l'écran (et qu'aucune fenêtre n'est ouverte)
setInterval(() => {
  if (document.visibilityState === 'visible' && etat.charge && !etat.fenetre && document.activeElement?.tagName !== 'INPUT') rafraichir();
}, 120000);

// ------------------------------------------------------------------ Stock

function pastille(s) { return el('span', { class: `pastille p-${s}` }, LIBELLES[s]); }

function ligneArticle(t, o, options) {
  const s = statut(t, o);
  const detail = el('div', { class: 'detail', hidden: true });
  const surAjout = options && options.surAjout;
  // Dans le choix d'un article pour un kit, toucher la ligne l'ajoute ; ailleurs, elle déplie le détail
  const action = surAjout ? () => surAjout(t, o) : () => { detail.hidden = !detail.hidden; if (!detail.hidden) remplirDetail(detail, t, o); };
  const ligne = el('div', { class: 'article', onclick: action },
    el('div', { class: 'etire' }, el('div', { class: 'nom' }, o.nom_court || o.nom || o.ref), el('div', { class: 'ref' }, o.ref || o.id)),
    el('div', { class: 'valeur' }, el('div', {}, valeurCourte(t, o) || '—'), pastille(s)),
    surAjout ? null : boutonRoue(t, o));
  return [ligne, detail];
}

// ------------------------------------------------------------------ ⚙ Modifier un article

/** Sanji, 11/11 : « sur le site on ne peut pas faire d'appui long : une petite roue crantée sur les articles pour les modifier ».
 *  Les mêmes champs et les mêmes règles que « Modifier l'article » de l'appli (appui long, Edition.kt). */
function boutonRoue(t, o) {
  return el('button', { class: 'roue', type: 'button', title: 'Modifier l\'article', 'aria-label': 'Modifier l\'article',
    onclick: ev => { ev.stopPropagation(); editeurArticle(t, o); } }, '⚙︎');
}

const REF_VALIDE = /^[A-Z0-9][A-Z0-9./-]*$/;
const AUTRE = '__autre__';

/** Liste déroulante : options = [[valeur, libellé]] ; la valeur null (« rien ») s'écrit ''. */
function choixListe(options, actuel) {
  const s = el('select', {}, options.map(([v, lib]) => el('option', { value: v === null ? '' : v }, lib)));
  s.value = actuel === null || actuel === undefined ? '' : actuel;
  return s;
}

/** Champ nombre : on garde le texte de départ pour ne rien réécrire si on n'y a pas touché. */
function champNombre(v, indice) {
  const txt = num(v) === null ? '' : nombreJoli(num(v));
  const c = el('input', { type: 'text', inputmode: 'decimal', value: txt, placeholder: indice });
  c.dataset.initial = txt;
  return c;
}
/** [bon ?, valeur] : vide → null ; pas un nombre ou négatif → pas bon ; inchangé → l'ancienne valeur exacte. */
function lireNombre(c, ancien) {
  if (!c) return [true, null];
  const t = c.value.trim();
  if (t === c.dataset.initial) return [true, num(ancien)];
  if (!t) return [true, null];
  const d = Number(t.replace(',', '.'));
  if (isNaN(d)) return [false, null];
  return [d >= 0, d];
}
function pareil(a, b) {
  const x = a === undefined ? null : a, y = b === undefined ? null : b;
  if (x === null || y === null) return x === null && y === null;
  if (typeof x === 'number' || typeof y === 'number') { const nx = Number(x), ny = Number(y); if (!isNaN(nx) && !isNaN(ny)) return nx === ny; }
  return String(x) === String(y);
}
/** Référence (ou identifiant) déjà prise par un autre article, corbeille comprise. */
function refPrise(ref, tSauf, idSauf) {
  const r = ref.toUpperCase();
  return ARTICLES.some(t => (etat.donnees[t] || []).some(o => !(t === tSauf && o.id === idSauf)
    && (String(o.ref || '').toUpperCase() === r || String(o.id || '').toUpperCase() === r)));
}
/** Largeurs (bobines) ou diamètres (descentes) existants, dans leur ordre. */
function groupesDe(t) {
  const vus = new Map();
  tous(t).forEach(o => { if (o.groupe && !vus.has(o.groupe)) vus.set(o.groupe, num(o.g_ordre) ?? 99); });
  return [...vus.entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
function gOrdre(t, g) {
  const o = (etat.donnees[t] || []).find(x => x.groupe === g && num(x.g_ordre) !== null);
  if (o) return num(o.g_ordre);
  return Math.max(0, ...(etat.donnees[t] || []).map(x => num(x.g_ordre) ?? 0)) + 1;
}
function ordreSuivant(t, g) {
  return Math.max(0, ...(etat.donnees[t] || []).filter(x => x.groupe === g).map(x => num(x.ordre) ?? 0)) + 1;
}
const triFr = (a, b) => a.localeCompare(b, 'fr');

function editeurArticle(t, o0) {
  const neuf = !o0;     // « + Nouvel article » (la ligne ajoutée au tableau)
  const o = neuf ? {} : (trouver(t, o0.id) || o0);
  const champ = (v, indice, extra) => el('input', { type: 'text', value: v === null || v === undefined ? '' : String(v), placeholder: indice, ...(extra || {}) });
  const nom = champ(o.nom, t === 'bobines' ? 'ex. Bobine 400 mm Gris 9006 / Cuivre' : t === 'descentes' ? 'ex. Descente Ø100 Anthracite 7016' : 'ex. Fond G300 Blanc');
  const nomCourt = champ(o.nom_court, 'court, pour l\'étiquette (26 caractères conseillés)');
  const ref = champ(o.ref, 'ex. FON-G300-BLA', { autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' });

  // Bobines et descentes : couleur, largeur ou diamètre (« Autre… » ouvre un champ libre)
  let couleur = null, groupe = null, groupeAutre = null;
  const titreGroupe = t === 'bobines' ? 'Largeur' : 'Diamètre';
  if (t !== 'accessoires') {
    couleur = champ(o.couleur, 'ex. Anthracite 7016');
    const gs = groupesDe(t);
    if (o.groupe && !gs.includes(o.groupe)) gs.push(o.groupe);
    groupe = choixListe([[null, '— choisir —'], ...gs.map(g => [g, g]), [AUTRE, 'Autre…']], o.groupe);
    groupeAutre = champ('', t === 'bobines' ? 'ex. 330 mm' : 'ex. Ø120', { hidden: true });
    groupe.addEventListener('change', () => { groupeAutre.hidden = groupe.value !== AUTRE; if (!groupeAutre.hidden) groupeAutre.focus(); });
  }

  // Rangement et achat
  const zs = tous('zones').filter(z => !z.est_groupe).sort((a, b) => triFr(String(a.id), String(b.id)));
  const optZones = zs.map(z => [z.id, `${z.id} · ${z.libelle || ''}`]);
  if (o.zone && !zs.some(z => z.id === o.zone)) optZones.push([o.zone, o.zone]);
  const zone = choixListe([[null, '— choisir —'], ...optZones], o.zone || (neuf ? ({ bobines: 'H1', descentes: 'H2' })[t] : null));
  let famille = null;
  if (t === 'accessoires') {
    const fs = [...new Set(tous('accessoires').map(x => x.famille).filter(Boolean).concat(o.famille ? [o.famille] : []))].sort(triFr);
    famille = choixListe([...fs.map(f => [f, f]), [null, 'Aucune']], o.famille);
  }
  // Fournisseurs : ceux du carnet (comme l'appli) ; à défaut, ceux déjà notés sur les articles
  let fours = tous('carnet').filter(c => c.type === 'fournisseur').map(c => String(c.libelle || '').trim()).filter(Boolean);
  if (!fours.length) fours = ARTICLES.flatMap(x => tous(x).map(a => a.fournisseur)).filter(Boolean);
  if (o.fournisseur) fours.push(o.fournisseur);
  const fournisseur = choixListe([...[...new Set(fours)].sort(triFr).map(f => [f, f]), [null, 'Aucun (N/A)']], o.fournisseur);

  // Façon de compter (accessoires), contenance et alerte : ce qui s'affiche dépend de la façon de compter
  let mode = o.mode || 'quantite';
  const modes = el('div', { class: 'puces' });
  const aideMode = el('p', { class: 'aide' });
  const titreSeuil = el('label', {});
  const seuil = champNombre(o.seuil, 'vide = alerte seulement quand il n\'y en a plus');
  const aideSeuil = el('p', { class: 'aide' });
  const blocSeuil = el('div', {}, titreSeuil, seuil, aideSeuil);
  let unite = null, parCarton = null, blocQuantite = null;
  if (t === 'accessoires') {
    const us = [['cartons', 'cartons'], ['rouleaux', 'rouleaux'], ['unités', 'unités']];
    tous('accessoires').map(x => x.unite).concat(o.unite ? [o.unite] : [])
      .forEach(u => { if (u && !us.some(x => x[0] === u)) us.push([u, u]); });
    unite = choixListe([[null, 'pièces (rien d\'écrit)'], ...us], o.unite);
    parCarton = champNombre(o.par_carton, 'ex. 100 (facultatif)');
    blocQuantite = el('div', {}, el('label', {}, 'Unité'), unite, el('label', {}, 'Contenance d\'un carton'), parCarton);
  } else if (t === 'descentes') {
    parCarton = champNombre(o.par_carton, 'ex. 7');
  }
  function majMode() {
    if (t === 'accessoires') {
      vider(modes).append(...[['quantite', 'Quantité'], ['niveau', 'Niveau'], ['mixte', 'Mixte']].map(([k, lib]) =>
        el('button', { type: 'button', class: k === mode ? 'actif' : '', onclick: () => { mode = k; majMode(); } }, lib)));
      aideMode.textContent = mode === 'niveau' ? 'On note seulement le niveau du carton ouvert (0/3 à 3/3). Alerte à 1/3 ou 0/3.'
        : mode === 'mixte' ? 'Cartons fermés, plus le niveau du carton ouvert.' : 'On compte des pièces ou des cartons.';
      titreSeuil.textContent = mode === 'mixte' ? 'Seuil : cartons fermés' : 'Seuil d\'alerte';
      aideSeuil.textContent = mode === 'mixte' ? 'Alerte quand il reste autant de cartons fermés ou moins, et l\'ouvert à 1/3 ou 0/3.'
        : 'Alerte quand il en reste autant ou moins.';
      blocQuantite.hidden = blocSeuil.hidden = mode === 'niveau';
    } else {
      titreSeuil.textContent = 'Seuil (mètres)';
      aideSeuil.textContent = t === 'bobines' ? 'Alerte quand aucune bobine n\'a au moins ce métrage.' : 'Alerte quand il reste autant de mètres ou moins.';
    }
  }
  majMode();
  const signaler = el('input', { type: 'checkbox', checked: o.signaler !== false });
  const note = el('textarea', { placeholder: 'facultatif' }, o.note || '');
  const msg = el('p', { class: 'erreur' });

  async function enregistrer(bouton) {
    msg.textContent = '';
    const net = x => { const v = String(x || '').trim(); return v || null; };
    const n = net(nom.value);
    if (!n) { msg.textContent = 'Il faut un nom.'; return; }
    const r = ref.value.trim().toUpperCase().replace(/\s+/g, '-');
    if (!REF_VALIDE.test(r)) { msg.textContent = 'Référence invalide : lettres sans accent, chiffres et tirets (ex. FON-G300-BLA).'; return; }
    const refChangee = r !== String(o.ref || '').toUpperCase();
    if (refChangee && refPrise(r, t, o.id)) { msg.textContent = `La référence ${r} existe déjà (corbeille comprise).`; return; }
    if (!zone.value) { msg.textContent = 'Choisis un emplacement.'; return; }
    let g = null;
    if (groupe) {
      g = groupe.value === AUTRE ? net(groupeAutre.value) : net(groupe.value);
      if (!g) { msg.textContent = t === 'bobines' ? 'Choisis une largeur.' : 'Choisis un diamètre.'; return; }
    }
    const [seuilOk, s] = lireNombre(seuil, o.seuil);
    if (!seuilOk) { msg.textContent = 'Le seuil doit être un nombre.'; return; }
    const [pcOk, pc] = lireNombre(parCarton, o.par_carton);
    if (!pcOk) { msg.textContent = 'La contenance doit être un nombre.'; return; }

    const valeurs = { nom: n, nom_court: net(nomCourt.value), ref: r, zone: zone.value, fournisseur: fournisseur.value || null,
      signaler: signaler.checked, note: net(note.value) };
    if (t === 'accessoires') {
      valeurs.famille = famille.value || null;
      valeurs.mode = mode;
      if (mode !== 'niveau') { valeurs.unite = unite.value || null; valeurs.par_carton = pc; valeurs.seuil = s; }   // en niveau, on n'y touche pas
    } else {
      valeurs.couleur = net(couleur.value);
      valeurs.groupe = g;
      valeurs.seuil = s;
      if (t === 'descentes') valeurs.par_carton = pc;
    }
    if (neuf) {
      // Article neuf : identifiant = référence (règle du document) ; il apparaît « à compter »
      const champsN = { ...valeurs, supprime: false };
      if (t === 'accessoires') champsN.suivi = true;
      if (t === 'bobines') champsN.metres = [];
      if (t !== 'accessoires') { champsN.g_ordre = gOrdre(t, g); champsN.ordre = ordreSuivant(t, g); }
      bouton.disabled = true;
      try {
        await ecrire(t, r, champsN);
        fermerFenetre();
        principal(etat.onglet);
        alert(`« ${n} » est créé : il apparaît « à compter ».`);
      } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
      return;
    }
    // Une case absente vaut sa valeur par défaut (alerte : oui ; façon de compter : quantité) : pas d'écriture inutile
    const ancienne = k => k === 'signaler' ? o.signaler !== false : k === 'mode' ? (o.mode || 'quantite') : o[k];
    const champs = {};
    Object.entries(valeurs).forEach(([k, v]) => { if (!pareil(ancienne(k), v)) champs[k] = v; });
    // Largeur ou diamètre changé : on le range à la fin de son nouveau groupe
    if (t !== 'accessoires' && 'groupe' in champs) { champs.g_ordre = gOrdre(t, g); champs.ordre = ordreSuivant(t, g); }
    if (!Object.keys(champs).length) { fermerFenetre(); return; }
    bouton.disabled = true;
    try {
      await ecrire(t, o.id, champs);
      fermerFenetre();
      principal(etat.onglet);
      if (refChangee) alert('Enregistré. La référence a changé : pense à réimprimer l\'étiquette.');
    } catch (e) { msg.textContent = e.message; bouton.disabled = false; }
  }

  async function corbeille(bouton) {
    if (!confirm(`Mettre « ${o.nom || o.ref} » à la corbeille ?\n\nIl disparaît du stock et des listes. Yannick peut l'en ressortir depuis l'appli.`)) return;
    bouton.disabled = true;
    try { await ecrire(t, o.id, { supprime: true }); fermerFenetre(); principal(etat.onglet); }
    catch (e) { msg.textContent = e.message; bouton.disabled = false; }
  }

  ouvrirFenetre(ajouterA(el('div', {}),
    el('h2', {}, neuf ? `Nouvel article : ${({ accessoires: 'accessoire', bobines: 'bobine', descentes: 'descente' })[t]}` : 'Modifier l\'article'),
    el('label', {}, 'Nom'), nom,
    el('label', {}, 'Nom court (étiquette)'), nomCourt,
    el('label', {}, 'Référence = code-barres'), ref,
    el('p', { class: 'aide' }, neuf ? 'Majuscules et tirets, la couleur à la fin. Elle ne doit pas déjà exister.'
      : 'La changer change le code-barres : il faudra réimprimer l\'étiquette.'),
    couleur ? [el('label', {}, 'Couleur'), couleur] : null,
    groupe ? [el('label', {}, titreGroupe), groupe, groupeAutre] : null,
    el('label', {}, 'Emplacement'), zone,
    famille ? [el('label', {}, 'Famille'), famille, el('p', { class: 'aide' }, 'Sert au rangement à l\'écran (pattes par couleur, accessoires gouttière par couleur…).')] : null,
    el('label', {}, 'Fournisseur'), fournisseur,
    t === 'accessoires' ? [el('label', {}, 'Façon de compter'), modes, aideMode, blocQuantite] : null,
    t === 'descentes' ? [el('label', {}, 'Tuyaux par carton'), parCarton] : null,
    blocSeuil,
    el('label', { class: 'case' }, signaler, 'Prévenir quand il en manque (À signaler)'),
    el('label', {}, 'Note'), note,
    neuf ? null : el('p', { class: 'aide', style: 'margin-top:12px' }, `Dernier changement : ${o.maj_par || '?'}${o.maj ? ' le ' + jour(o.maj) : ''}`),
    msg,
    el('button', { class: 'principal', onclick: ev => enregistrer(ev.currentTarget) }, neuf ? 'Créer l\'article' : 'Enregistrer'),
    neuf ? null : el('button', { class: 'second danger', style: 'width:100%;margin-top:8px', onclick: ev => corbeille(ev.currentTarget) }, 'Mettre à la corbeille'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Annuler')),
    { fixe: true });   // on ne perd pas la saisie en touchant à côté par erreur
}

function remplirDetail(d, t, o) {
  vider(d);
  const s = statut(t, o);
  ajouterA(d,
    o.manque ? el('div', { class: 'manque' }, texteManque(o)) : null,
    el('div', {}, resume(t, o) || 'Pas encore compté'),
    o.compte ? el('div', {}, `Compté le ${jourHeure(o.compte)}${o.compte_par ? ' par ' + o.compte_par : ''}`) : null,
    o.mouvement ? el('div', {}, `Dernier mouvement : ${mouvementTexte(o.mouvement)}, le ${jourHeure(o.mouvement.quand)}`) : null,
    sorties(o).length ? el('div', {}, 'Sorties : ' + sorties(o).map(x => `${nombreJoli(num(x.m))} ml (${x.ouvrier || '?'})`).join(', ')) : null,
    o.fournisseur ? el('div', {}, `Fournisseur : ${o.fournisseur}`) : null,
    o.note ? el('div', {}, `Note : ${o.note}`) : null,
    enAlerte(s) ? el('div', { class: 'rangee', style: 'margin-top:8px' }, boutonVu(t, o), o.manque ? boutonManqueRegle(t, o) : null) : null);
}

/** Le manque est réglé (commandé, arrivé…) : il ne s'affiche plus en rouge vif. */
function boutonManqueRegle(t, o) {
  return el('button', {
    class: 'petit', onclick: async ev => {
      ev.stopPropagation();
      if (!confirm('Le manque est réglé ?')) return;
      try { await ecrire(t, o.id, { manque: null }); principal(etat.onglet); } catch (e) { alert(e.message); }
    },
  }, 'Manque réglé');
}

/** « Vu » : l'alerte est vue (on sait qu'il faut commander) ; elle repart d'elle-même quand le stock remonte. */
function boutonVu(t, o) {
  const vu = !!o.alerte_vue;
  return el('button', {
    class: 'petit', onclick: async ev => {
      ev.stopPropagation();
      try {
        await ecrire(t, o.id, vu ? { alerte_vue: null, alerte_vue_par: null } : { alerte_vue: new Date().toISOString(), alerte_vue_par: etat.identifiant });
        principal(etat.onglet);
      } catch (e) { alert(e.message); }
    },
  }, vu ? '✓ Vu (enlever)' : '☐ Marquer « Vu »');
}

function pageStock(corps) {
  const champ = el('input', { type: 'search', placeholder: 'Chercher un article, une réf, une couleur', value: etat.recherche });
  const puces = el('div', { class: 'puces' });
  const liste = el('div');
  const tousArticles = ARTICLES.flatMap(t => tous(t).filter(o => t !== 'accessoires' || o.suivi !== false).map(o => ({ t, o, s: statut(t, o) })));
  const filtres = [['tous', 'Tous', tousArticles.length], ['signaler', 'À signaler', tousArticles.filter(x => enAlerte(x.s)).length], ['compter', 'À compter', tousArticles.filter(x => x.s === 'COMPTER').length]];
  function dessinerPuces() {
    vider(puces).append(...filtres.map(([k, lib, n]) => el('button', { class: k === etat.filtre ? 'actif' : '', onclick: () => { etat.filtre = k; dessinerPuces(); dessiner(); } }, `${lib}  ${n}`)));
  }
  function garde(t, o) {
    const s = statut(t, o);
    if (etat.filtre === 'signaler' && !enAlerte(s)) return false;
    if (etat.filtre === 'compter' && s !== 'COMPTER') return false;
    const mots = normaliser(etat.recherche).split(/\s+/).filter(Boolean);
    if (!mots.length) return true;
    const h = normaliser([o.ref, o.nom, o.nom_court, o.zone, o.fournisseur, o.famille, o.couleur].join(' '));
    return mots.every(m => h.includes(m));
  }
  const toutOuvrir = () => etat.filtre !== 'tous' || etat.recherche.trim() !== '';
  function dossierZone(n, parent) {
    const z = n.zone;
    let articles = [];
    const sous = [];
    if (n.enfants.length) n.enfants.forEach(x => { const r = dossierZone(x, null); if (r) { sous.push(r.vue); articles = articles.concat(r.articles); } });
    else articles = articlesDuRayon(z.id).filter(x => garde(x.t, x.o));
    if (!articles.length) return null;
    const nAlerte = articles.filter(x => enAlerte(statut(x.t, x.o))).length;
    const cle = 'z:' + z.id;
    const d = el('details', { class: 'dossier', open: toutOuvrir() || etat.ouverts.has(cle), ontoggle: () => d.open ? etat.ouverts.add(cle) : etat.ouverts.delete(cle) },
      el('summary', {}, `${z.id} · ${z.libelle || ''}`, el('span', { class: 'compte' + (nAlerte ? ' alerte' : '') }, nAlerte ? `${nAlerte} à signaler` : `${articles.length} article${articles.length > 1 ? 's' : ''}`)));
    if (n.enfants.length) d.append(...sous);
    else articles.forEach(x => d.append(...ligneArticle(x.t, x.o)));
    return { vue: d, articles };
  }
  function dessiner() {
    vider(liste);
    let rien = true;
    const enTableau = affichageStock() === 'tableau';
    for (const e of arbreZones()) {
      if (enTableau) {
        const tab = tableauEntrepot(e, garde, toutOuvrir, dessiner);
        if (!tab) continue;
        rien = false;
        liste.append(el('div', { class: 'titre-section' }, `Entrepôt ${e.entrepot}` + (e.entrepot === 1 ? ' · accessoires' : ' · alu et zinc')), tab);
        continue;
      }
      const blocs = e.enfants.map(n => dossierZone(n)).filter(Boolean);
      if (!blocs.length) continue;
      rien = false;
      liste.append(el('div', { class: 'titre-section' }, `Entrepôt ${e.entrepot}` + (e.entrepot === 1 ? ' · accessoires' : ' · alu et zinc')));
      blocs.forEach(b => liste.append(b.vue));
    }
    if (rien) liste.append(el('p', { class: 'aide' }, tousArticles.length ? 'Aucun article ne correspond.' : 'Rien à afficher : touche ⟳.'));
  }
  champ.addEventListener('input', () => { etat.recherche = champ.value; dessiner(); });
  dessinerPuces(); dessiner();
  // « + Nouvel article » (ajouter une ligne) ; en tableau, « ☰ Colonnes » (la disposition de chacun)
  const outils = ajouterA(el('div', { class: 'rangee', style: 'margin-bottom:10px' }),
    el('button', { class: 'second etire', onclick: nouvelArticle }, '+ Nouvel article'),
    affichageStock() === 'tableau' ? el('button', { class: 'second', onclick: () => fenetreColonnes(() => principal('stock')) }, '☰ Colonnes') : null);
  corps.append(outils, champ, puces, liste);
}

// ------------------------------------------------------------------ Stock en tableau (façon Excel)

/** Sanji, 11/11 : « un aperçu plus Excel serait plus simple pour eux, avec des trucs qui peuvent se déployer ;
 *  possible d'avoir les deux ? réglable dans les paramètres en type d'affichage des stocks ».
 *  Le choix est retenu sur l'appareil (chacun le sien) ; d'office : le tableau. */
function affichageStock() { return lireStockage('sd_affichage') === 'dossiers' ? 'dossiers' : 'tableau'; }

/** Toutes les colonnes possibles (Sanji : « que le site mémorise la disposition des patrons, la possibilité d'ajouter
 *  des colonnes, et que ça ne casse pas tout »). « Article » reste la première et ⚙ la dernière ; les autres se
 *  choisissent et se rangent (☰ Colonnes). On ne fait que montrer ce que le document connaît déjà : rien ne peut casser.
 *  Une colonne vraiment nouvelle (une donnée qui n'existe pas) passe par Yannick et Claude : demande dans ✎ Idées. */
const ORDRE_ETAT = { MANQUE: 0, SIGNALER: 1, VUE: 2, COMPTER: 3, DECIDER: 4, OK: 5, CORBEILLE: 6 };
function quantiteTri(t, o) {
  if (t === 'bobines') { const m = metres(o); return m.length ? m.reduce((a, x) => a + x, 0) : null; }
  if (t === 'descentes') return metresDescente(o);
  if (o.mode === 'niveau') { const i = niveaux().findIndex(n => n[0] === o.niveau); return i < 0 ? null : i; }
  return num(o.quantite);
}
const MODES = { quantite: 'Quantité', niveau: 'Niveau', mixte: 'Mixte' };
const COLONNES_TOUTES = [
  { k: 'ref', titre: 'Réf.', classe: 'ref', val: (t, o) => o.ref || o.id, tri: (t, o) => o.ref || o.id },
  { k: 'stock', titre: 'Stock', classe: 'nombre', val: (t, o) => valeurCourte(t, o) || '—', tri: quantiteTri },
  { k: 'etat', titre: 'État', val: (t, o) => pastille(statut(t, o)), tri: (t, o) => ORDRE_ETAT[statut(t, o)] ?? 9 },
  { k: 'seuil', titre: 'Seuil', val: (t, o) => seuilTexte(t, o), tri: (t, o) => num(o.seuil) },
  { k: 'fournisseur', titre: 'Fournisseur', val: (t, o) => o.fournisseur || '—', tri: (t, o) => o.fournisseur },
  { k: 'compte', titre: 'Compté le', val: (t, o) => o.compte ? jour(o.compte) : '—', tri: (t, o) => o.compte },
  { k: 'zone', titre: 'Emplacement', val: (t, o) => o.zone || '—', tri: (t, o) => o.zone },
  { k: 'famille', titre: 'Famille', val: (t, o) => o.famille || '—', tri: (t, o) => o.famille },
  { k: 'couleur', titre: 'Couleur', val: (t, o) => o.couleur || '—', tri: (t, o) => o.couleur },
  { k: 'groupe', titre: 'Largeur / Ø', val: (t, o) => o.groupe || '—', tri: (t, o) => o.groupe },
  { k: 'mode', titre: 'Façon de compter', val: (t, o) => t === 'accessoires' ? MODES[o.mode || 'quantite'] || o.mode : 'Mètres', tri: (t, o) => t === 'accessoires' ? (o.mode || 'quantite') : 'metres' },
  { k: 'unite', titre: 'Unité', val: (t, o) => t !== 'accessoires' ? 'ml' : o.mode === 'niveau' ? '—' : (o.unite || 'pièces'), tri: (t, o) => t !== 'accessoires' ? 'ml' : (o.unite || 'pièces') },
  { k: 'par_carton', titre: 'Contenance', val: (t, o) => num(o.par_carton) === null ? '—' : nombreJoli(num(o.par_carton)), tri: (t, o) => num(o.par_carton) },
  { k: 'note', titre: 'Note', classe: 'note', val: (t, o) => o.note || '—', tri: (t, o) => o.note },
  { k: 'maj', titre: 'Dernier changement', val: (t, o) => o.maj ? `${jour(o.maj)}${o.maj_par ? ' · ' + o.maj_par : ''}` : '—', tri: (t, o) => o.maj },
];
const COLONNES_ORIGINE = ['ref', 'stock', 'etat', 'seuil', 'fournisseur', 'compte'];

/** La disposition est retenue dans le document, au nom du compte : elle suit chaque patron sur tous ses appareils. */
function cleDisposition() { return 'site_tableau_' + normaliser(etat.identifiant || 'moi').replace(/[^a-z0-9]+/g, '_'); }
function colonnesChoisies() {
  const r = reglage(cleDisposition());
  const l = r && Array.isArray(r.colonnes) ? r.colonnes.filter(k => COLONNES_TOUTES.some(c => c.k === k)) : null;
  return (l || COLONNES_ORIGINE).map(k => COLONNES_TOUTES.find(c => c.k === k));
}
async function enregistrerColonnes(choix) {
  await ecrire('reglages', cleDisposition(), { valeur: { colonnes: choix }, description: `Disposition du tableau du site pour ${etat.identifiant}`, supprime: false });
}

/** Tri : on touche le titre d'une colonne (une fois : croissant, deux fois : décroissant, trois fois : plus de tri).
 *  Il range les articles à l'intérieur de chaque rayon ; il est retenu sur l'appareil. */
function triActuel() { try { const x = JSON.parse(lireStockage('sd_tri') || 'null'); return x && x.k ? x : null; } catch (e) { return null; } }
function changerTri(k, redessiner) {
  const tr = triActuel();
  const suivant = !tr || tr.k !== k ? { k, sens: 1 } : tr.sens === 1 ? { k, sens: -1 } : null;
  ecrireStockage('sd_tri', suivant ? JSON.stringify(suivant) : null);
  redessiner();
}
function trier(articles) {
  const tr = triActuel();
  if (!tr) return articles;
  const c = tr.k === 'article' ? { tri: (t, o) => o.nom_court || o.nom || o.ref } : COLONNES_TOUTES.find(x => x.k === tr.k);
  if (!c) return articles;
  const v = x => { const y = c.tri(x.t, x.o); return y === undefined || y === null || y === '' ? null : y; };
  return [...articles].sort((a, b) => {
    const x = v(a), y = v(b);
    if (x === null || y === null) return (x === null) - (y === null);      // les cases vides toujours à la fin
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { numeric: true });
    return r * tr.sens;
  });
}

/** ☰ Colonnes : cocher ce qu'on veut voir, ranger avec ↑ ↓. */
function fenetreColonnes(apres) {
  let choix = colonnesChoisies().map(c => c.k);
  const liste = el('div');
  function dessiner() {
    vider(liste);
    const ordre = [...choix, ...COLONNES_TOUTES.map(c => c.k).filter(k => !choix.includes(k))];
    ordre.forEach(k => {
      const c = COLONNES_TOUTES.find(x => x.k === k);
      const i = choix.indexOf(k), on = i >= 0;
      liste.append(ajouterA(el('div', { class: 'ligne-colonne' }),
        el('label', { class: 'case etire' },
          el('input', { type: 'checkbox', checked: on, onchange: ev => { if (ev.target.checked) choix.push(k); else choix = choix.filter(x => x !== k); dessiner(); } }),
          c.titre),
        on ? el('button', { class: 'petit', disabled: i === 0, onclick: () => { [choix[i - 1], choix[i]] = [choix[i], choix[i - 1]]; dessiner(); } }, '↑') : null,
        on ? el('button', { class: 'petit', disabled: i === choix.length - 1, onclick: () => { [choix[i + 1], choix[i]] = [choix[i], choix[i + 1]]; dessiner(); } }, '↓') : null));
    });
  }
  dessiner();
  const msg = el('p', { class: 'erreur' });
  ouvrirFenetre(el('div', {},
    el('h2', {}, 'Colonnes du tableau'),
    el('p', { class: 'aide' }, '« Article » reste toujours la première colonne. Coche ce que tu veux voir et range avec ↑ ↓. C\'est retenu sur ton compte, sur tous tes appareils. Pour trier, touche le titre d\'une colonne dans le tableau. Une colonne nouvelle (une information qui n\'existe pas encore) : demande-la dans ✎ Idées.'),
    liste, msg,
    el('button', { class: 'principal', onclick: async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try { await enregistrerColonnes(choix); fermerFenetre(); apres(); } catch (e) { msg.textContent = e.message; b.disabled = false; }
    } }, 'Enregistrer'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => { choix = [...COLONNES_ORIGINE]; dessiner(); } }, 'Remettre comme au début'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Annuler')),
    { fixe: true });
}

/** « + Nouvel article » (ajouter une ligne) : d'abord le type, puis le même formulaire que ⚙. */
function nouvelArticle() {
  ouvrirFenetre(el('div', {},
    el('h2', {}, 'Nouvel article : quel type ?'),
    [['accessoires', 'Accessoire (pièces, cartons, niveau…)'], ['bobines', 'Bobine'], ['descentes', 'Descente']].map(([t, lib]) =>
      el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => editeurArticle(t, null) }, lib)),
    el('button', { class: 'second', style: 'width:100%;margin-top:16px', onclick: fermerFenetre }, 'Annuler')));
}

function seuilTexte(t, o) {
  if (t === 'accessoires' && o.mode === 'niveau') return '1/3';
  const s = num(o.seuil);
  if (s === null) return '—';
  if (t !== 'accessoires') return `${nombreJoli(s)} ml`;
  if (o.mode === 'mixte') return `${nombreJoli(s)} carton(s)`;
  return nombreJoli(s) + (o.unite ? ' ' + o.unite : '');
}

/** Un entrepôt en tableau : une ligne par article, des lignes de groupe (zones, rayons) qui se plient et se déplient. */
function tableauEntrepot(e, garde, toutOuvrir, redessiner) {
  function collecter(n) {
    if (n.enfants.length) {
      const sous = n.enfants.map(collecter).filter(Boolean);
      const articles = sous.flatMap(s => s.articles);
      return articles.length ? { z: n.zone, sous, articles } : null;
    }
    const articles = articlesDuRayon(n.zone.id).filter(x => garde(x.t, x.o));
    return articles.length ? { z: n.zone, sous: null, articles } : null;
  }
  const blocs = e.enfants.map(collecter).filter(Boolean);
  if (!blocs.length) return null;
  const cols = colonnesChoisies();
  const nCol = cols.length + 2;          // + Article (au début) et ⚙ (à la fin)
  const tr = triActuel();
  const fleche = k => tr && tr.k === k ? (tr.sens === 1 ? ' ▲' : ' ▼') : '';
  const corpsT = el('tbody');
  function rendre(b, niveau) {
    const cle = 'z:' + b.z.id;
    const ouvert = toutOuvrir() || etat.ouverts.has(cle);
    const nAlerte = b.articles.filter(x => enAlerte(statut(x.t, x.o))).length;
    const nb = b.articles.length;
    corpsT.append(el('tr', { class: 'groupe', onclick: () => { if (ouvert) etat.ouverts.delete(cle); else etat.ouverts.add(cle); redessiner(); } },
      el('td', { colspan: nCol },
        el('span', { class: 'colle', style: `padding-left:${niveau * 18}px` }, `${ouvert ? '▾' : '▸'} ${b.z.id} · ${b.z.libelle || ''}`,
          el('span', { class: 'compte' + (nAlerte ? ' alerte' : '') }, nAlerte ? `${nAlerte} à signaler` : `${nb} article${nb > 1 ? 's' : ''}`)))));
    if (!ouvert) return;
    if (b.sous) b.sous.forEach(s => rendre(s, niveau + 1));
    else trier(b.articles).forEach(x => corpsT.append(...ligneTableau(x.t, x.o, cols)));
  }
  blocs.forEach(b => rendre(b, 0));
  const titre = (k, texte, classe) => el('th', { class: 'triable' + (classe ? ' ' + classe : ''), title: 'Trier', onclick: () => changerTri(k, redessiner) }, texte + fleche(k));
  return el('div', { class: 'tableau-cadre' },
    el('table', { class: 'tableau' },
      el('thead', {}, el('tr', {}, titre('article', 'Article', 'col1'), cols.map(c => titre(c.k, c.titre)), el('th', {}, ''))),
      corpsT));
}

/** Une ligne d'article ; la toucher ouvre le détail juste dessous (comme en dossiers). */
function ligneTableau(t, o, cols) {
  const s = statut(t, o);
  const contenu = el('div', { class: 'detail colle' });
  const detail = el('tr', { class: 'detail-ligne', hidden: true }, el('td', { colspan: cols.length + 2 }, contenu));
  const ligne = el('tr', { class: 'ligne-article' + (s === 'MANQUE' ? ' manque-ligne' : ''), onclick: () => {
    detail.hidden = !detail.hidden; if (!detail.hidden) remplirDetail(contenu, t, o);
  } },
    el('td', { class: 'col1', title: o.nom || o.ref }, o.nom_court || o.nom || o.ref),
    cols.map(c => el('td', { class: c.classe || '' }, c.val(t, o))),
    el('td', { class: 'roue-case' }, boutonRoue(t, o)));
  return [ligne, detail];
}

// ------------------------------------------------------------------ À signaler

function pageSignaler(corps) {
  const elements = ARTICLES.flatMap(t => tous(t).map(o => ({ t, o, s: statut(t, o) }))).filter(x => enAlerte(x.s));
  // D'office : les rouges (et les manques, rouge vif, en tête) sont cochés, les « Vu » non ; on change à la main
  elements.forEach(x => { const k = x.t + '|' + x.o.id; if (!etat.coches.has(k)) etat.coches.set(k, x.s === 'SIGNALER' || x.s === 'MANQUE'); });
  elements.sort((a, b) => (b.s === 'MANQUE') - (a.s === 'MANQUE'));
  const zones = Object.fromEntries(tous('zones').map(z => [z.id, z]));
  const entrepot = x => num(zones[x.o.zone]?.entrepot) ?? (x.t === 'accessoires' ? 1 : 2);
  const coche = x => etat.coches.get(x.t + '|' + x.o.id);
  function texte() {
    let s = `Stock à signaler au ${fmtJourAn.format(new Date())}\n`;
    [...new Set(elements.map(entrepot))].sort().forEach(ent => {
      const l = elements.filter(x => entrepot(x) === ent && coche(x));
      if (!l.length) return;
      s += `\nEntrepôt ${ent}\n`;
      const parF = {};
      l.forEach(x => (parF[x.o.fournisseur || 'Sans fournisseur (N/A)'] ||= []).push(x));
      Object.keys(parF).sort().forEach(f => {
        s += `${f} :\n`;
        parF[f].forEach(x => { s += `- ${x.o.nom || x.o.ref} (${x.o.ref}) : ${valeurCourte(x.t, x.o) || '?'}\n`; });
      });
    });
    return s;
  }
  const n = elements.filter(coche).length;
  corps.append(
    el('div', { class: 'rangee' },
      el('button', { class: 'second', onclick: async () => { try { await navigator.clipboard.writeText(texte()); alert('Copié : tu peux le coller dans un message.'); } catch (e) { prompt('Copie ce texte :', texte()); } } }, `Copier (${n})`),
      navigator.share ? el('button', { class: 'second', onclick: () => navigator.share({ title: 'Stock à signaler', text: texte() }).catch(() => {}) }, `Partager (${n})`) : null),
    el('p', { class: 'aide' }, `${elements.length} à signaler · les « Vu » (déjà vus, en orange) ne sont pas cochés d'office.`));
  if (!elements.length) { corps.append(el('div', { class: 'carte' }, 'Rien à signaler.')); return; }
  [...new Set(elements.map(entrepot))].sort().forEach(ent => {
    corps.append(el('div', { class: 'titre-section' }, `Entrepôt ${ent}`));
    const parF = {};
    elements.filter(x => entrepot(x) === ent).forEach(x => (parF[x.o.fournisseur || 'Sans fournisseur (N/A)'] ||= []).push(x));
    Object.keys(parF).sort().forEach(f => {
      const bloc = el('div', { class: 'carte' }, el('div', { style: 'font-weight:700;margin-bottom:6px' }, f));
      parF[f].forEach(x => {
        const k = x.t + '|' + x.o.id;
        bloc.append(el('div', { class: 'rangee', style: 'padding:6px 0;border-top:1px solid var(--ligne)' },
          el('input', { type: 'checkbox', checked: coche(x), onchange: ev => { etat.coches.set(k, ev.target.checked); principal('signaler'); } }),
          el('div', { class: 'etire' }, el('div', { class: 'nom' }, x.o.nom || x.o.ref), el('div', { class: 'ref' }, `${x.o.ref} · ${valeurCourte(x.t, x.o) || '?'}`),
            x.o.manque ? el('div', { class: 'manque' }, texteManque(x.o)) : null),
          pastille(x.s), x.o.manque ? boutonManqueRegle(x.t, x.o) : boutonVu(x.t, x.o)));
      });
      corps.append(bloc);
    });
  });
}

// ------------------------------------------------------------------ Kits

const kitsActifs = () => tous('kits');
function nomKit(k) { return (k.client && k.client.trim()) || (k.libelle && k.libelle.trim()) || `Kit du ${jour(k.cree_le || k.maj)}`; }
function uniteLigne(t, o, u) { return t === 'bobines' ? 'bobine(s)' : t === 'descentes' ? (u || 'tuyaux') : (o && o.mode === 'mixte' ? 'carton(s) fermé(s)' : (o && o.unite) || 'pièce(s)'); }

function pageKits(corps) {
  const att = kitsActifs().filter(k => !k.pret).sort((a, b) => (a.cree_le || '').localeCompare(b.cree_le || ''));
  const prets = kitsActifs().filter(k => k.pret).sort((a, b) => (b.pret_le || '').localeCompare(a.pret_le || ''));
  corps.append(el('button', { class: 'principal', style: 'margin:0 0 6px', onclick: () => editeurKit(null) }, '+ Nouveau kit'));
  corps.append(el('div', { class: 'titre-section' }, `À préparer (${att.length})`));
  if (!att.length) corps.append(el('p', { class: 'aide' }, 'Aucun kit en attente.'));
  att.forEach(k => corps.append(carteKit(k)));
  const d = el('details', { class: 'dossier', style: 'margin-top:16px' }, el('summary', {}, `Prêts · archivés (${prets.length})`));
  prets.forEach(k => d.append(el('div', { style: 'padding:0 10px 4px' }, carteKit(k))));
  corps.append(d);
}

function carteKit(k) {
  const n = (k.lignes || []).length;
  return el('div', { class: 'carte kit', style: 'cursor:pointer', onclick: () => editeurKit(k) },
    el('div', { class: 'coche', title: k.pret ? 'Prêt' : 'En attente' }, k.pret ? '☑' : '☐'),
    el('div', { class: 'contenu' },
      el('div', { style: 'font-weight:700' }, nomKit(k)),
      el('div', { class: 'aide' }, [`${n} article${n > 1 ? 's' : ''}`, k.pret ? `prêt le ${jourHeure(k.pret_le)}${k.pret_par ? ' par ' + k.pret_par : ''}` : `demandé le ${jour(k.cree_le || k.maj)}${k.demande_par ? ' par ' + k.demande_par : ''}`].join(' · ')),
      k.note ? el('div', { style: 'color:var(--accent);font-size:14px' }, k.note) : null));
}

function ouvrirFenetre(contenu, options) {
  // On remplace la fenêtre ouverte sans « fermer » le kit en cours (choix d'un article, scanner, questions…)
  if (etat.fenetre) { etat.fenetre.remove(); etat.fenetre = null; }
  // options.fixe : toucher à côté ne ferme pas (un formulaire en cours ne se perd pas par erreur)
  const fixe = !!(options && options.fixe);
  const voile = el('div', { class: 'voile', onclick: ev => { if (ev.target === voile && !fixe) fermerFenetre(); } }, el('div', { class: 'fenetre' }, contenu));
  document.body.append(voile);
  etat.fenetre = voile;
}
function fermerFenetre() { if (etat.fenetre) { etat.fenetre.remove(); etat.fenetre = null; } etat.kitEnCours = null; }

/** Créer ou modifier un kit (le panier) ; un kit prêt se regarde seulement (le préparer ou le défaire, c'est dans l'appli). */
function editeurKit(k0) {
  const k = k0 ? trouver('kits', k0.id) || k0 : null;
  const pret = !!(k && k.pret);
  const brouillon = { client: k ? (k.client || '') : '', note: k ? (k.note || '') : '', lignes: (k && Array.isArray(k.lignes) ? k.lignes : []).map(l => ({ ...l })) };
  const zone = el('div');
  function dessiner() {
    vider(zone);
    const client = el('input', { type: 'text', value: brouillon.client, placeholder: 'Nom du client ou du chantier', disabled: pret, oninput: e => { brouillon.client = e.target.value; } });
    const note = el('textarea', { placeholder: 'Pour quand…', disabled: pret, oninput: e => { brouillon.note = e.target.value; } }, brouillon.note);
    const panier = el('div');
    if (!brouillon.lignes.length) panier.append(el('p', { class: 'aide' }, 'Le panier est vide.'));
    brouillon.lignes.forEach((l, i) => {
      const o = trouver(l.t, l.id);
      const nVue = el('span', { class: 'n' }, nombreJoli(num(l.n) ?? 1));
      const bob = Array.isArray(l.bobines) && l.bobines.length ? ` · bobines choisies : ${l.bobines.map(x => nombreJoli(Number(x))).join(' + ')} ml` : '';
      panier.append(el('div', { class: 'ligne-panier' },
        el('div', { class: 'etire' }, el('div', { class: 'nom' }, (o && (o.nom_court || o.nom)) || l.id),
          el('div', { class: 'ref' }, `${(o && o.ref) || ''} · en stock : ${(o && resume(l.t, o)) || 'pas compté'}${bob}`),
          o && o.manque ? el('div', { class: 'manque' }, texteManque(o)) : null),
        pret ? null : el('button', { class: 'petit', onclick: () => {
          if (l.t === 'bobines') { choisirBobines(brouillon, o, l, dessiner); return; }
          l.n = Math.max(1, (num(l.n) ?? 1) - 1); nVue.textContent = nombreJoli(l.n);
        } }, '−'),
        nVue,
        pret ? null : el('button', { class: 'petit', onclick: () => {
          if (!o) return;
          if (l.t === 'bobines') { choisirBobines(brouillon, o, l, dessiner); return; }
          const avant = num(l.n) ?? 1;
          l.n = avant + 1;
          verifierManque(l, o, () => { l.n = avant; }, dessiner);
        } }, '+'),
        l.t === 'descentes' && !pret ? el('button', { class: 'petit', onclick: () => { l.u = (l.u || 'tuyaux') === 'tuyaux' ? 'cartons' : 'tuyaux'; dessiner(); } }, l.u || 'tuyaux')
          : el('span', { class: 'aide' }, uniteLigne(l.t, o, l.u)),
        pret ? null : el('button', { class: 'petit danger', onclick: () => { brouillon.lignes.splice(i, 1); dessiner(); } }, '✕')));
    });
    const msg = el('p', { class: 'erreur' });
    ajouterA(zone,
      el('h2', {}, k ? nomKit(k) : 'Nouveau kit'),
      pret ? el('p', { class: 'ok' }, `✓ Prêt le ${jourHeure(k.pret_le)}${k.pret_par ? ' par ' + k.pret_par : ''}. Pour le modifier ou l'annuler, demande à Yannick de le décocher dans l'appli.`) : null,
      el('label', {}, 'Client'), client,
      el('label', {}, 'Note'), note,
      el('label', {}, `Articles (${brouillon.lignes.length})`), panier,
      pret ? null : el('div', { class: 'rangee', style: 'margin-top:10px' },
        el('button', { class: 'second etire', onclick: () => choisirArticle(brouillon, dessiner) }, '+ Ajouter un article'),
        el('button', { class: 'second', onclick: () => scanner(code => {
          const x = trouverParCode(code);
          if (!x) { alert(`Code inconnu : ${code}`); return; }
          ajouterAuKit(brouillon, x.t, x.o, dessiner);
        }) }, '▣ Scanner')),
      msg,
      pret ? null : el('button', {
        class: 'principal', onclick: async ev => {
          if (!brouillon.lignes.length) { msg.textContent = 'Ajoute au moins un article.'; return; }
          ev.target.disabled = true;
          const champs = { client: brouillon.client.trim().slice(0, 80) || null, note: brouillon.note.trim().slice(0, 500) || null,
            lignes: brouillon.lignes.map(l => ({ t: l.t, id: l.id, n: num(l.n) ?? 1, ...(l.u ? { u: l.u } : {}),
              ...(Array.isArray(l.bobines) && l.bobines.length ? { bobines: l.bobines.map(Number) } : {}) })) };
          try {
            if (k) await ecrire('kits', k.id, champs);
            else {
              const d = new Date(), p = x => String(x).padStart(2, '0');
              const id = `K-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${hex(2)}`;
              await ecrire('kits', id, { ...champs, libelle: '', pret: false, demande_par: etat.identifiant, supprime: false, cree_le: d.toISOString() });
            }
            fermerFenetre(); await rafraichir();
          } catch (e) { msg.textContent = e.message; ev.target.disabled = false; }
        },
      }, 'Enregistrer'),
      k && !pret ? el('button', {
        class: 'second danger', style: 'width:100%;margin-top:8px', onclick: async () => {
          if (!confirm(`Supprimer le kit « ${nomKit(k)} » ?`)) return;
          try { await ecrire('kits', k.id, { supprime: true }); fermerFenetre(); await rafraichir(); } catch (e) { msg.textContent = e.message; }
        },
      }, 'Supprimer le kit') : null,
      el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Fermer'));
  }
  dessiner();
  ouvrirFenetre(zone);
  // Une douchette branchée ajoute au panier tant que ce kit est ouvert (pas pour un kit déjà prêt)
  etat.kitEnCours = pret ? null : { brouillon, dessiner };
}

/** Ajouter un article au panier : recherche en haut, tout le stock à dérouler en dessous. */
function choisirArticle(brouillon, retour) {
  const zone = el('div');
  const champ = el('input', { type: 'search', placeholder: 'Réf ou nom (ex. coude 80 blanc)' });
  const res = el('div', { class: 'choix' });
  const ajouter = (t, o) => { ouvrirFenetre(zonePanier); ajouterAuKit(brouillon, t, o, retour); };
  const zonePanier = etat.fenetre.firstChild.firstChild;
  function dessiner() {
    vider(res);
    const mots = normaliser(champ.value).split(/\s+/).filter(Boolean);
    if (mots.length) {
      const l = ARTICLES.flatMap(t => tous(t).map(o => ({ t, o })))
        .filter(x => { const h = normaliser([x.o.ref, x.o.nom, x.o.nom_court].join(' ')); return mots.every(m => h.includes(m)); }).slice(0, 40);
      if (!l.length) res.append(el('p', { class: 'aide', style: 'padding:10px' }, 'Rien ne correspond.'));
      l.forEach(x => res.append(ligneArticle(x.t, x.o, { surAjout: ajouter })[0]));
      return;
    }
    for (const e of arbreZones()) {
      res.append(el('div', { class: 'titre-section' }, `Entrepôt ${e.entrepot}`));
      const dossier = n => {
        const d = el('details', { class: 'dossier' }, el('summary', {}, `${n.zone.id} · ${n.zone.libelle || ''}`));
        let rempli = false;
        d.addEventListener('toggle', () => {
          if (!d.open || rempli) return;
          rempli = true;
          if (n.enfants.length) n.enfants.forEach(x => d.append(dossier(x)));
          else articlesDuRayon(n.zone.id).forEach(x => d.append(ligneArticle(x.t, x.o, { surAjout: ajouter })[0]));
        });
        return d;
      };
      e.enfants.forEach(n => res.append(dossier(n)));
    }
  }
  champ.addEventListener('input', dessiner);
  zone.append(el('h2', {}, 'Ajouter au kit'), champ, res,
    el('button', { class: 'second', style: 'width:100%;margin-top:10px', onclick: () => { ouvrirFenetre(zonePanier); retour(); } }, 'Retour au panier'));
  dessiner();
  ouvrirFenetre(zone);
  champ.focus();
}

// ------------------------------------------------------------------ ajouter à un kit : choix des bobines, manque

/**
 * Sanji, 11/11 : « si je scanne dans un kit, ça ajoute s'il y en a ; s'il y a un choix ou un manque, il me demande quoi faire ;
 * s'il manque un truc, ça passe en À signaler rouge vif ; pour les bobines, il me demande laquelle je choisis ».
 */
function ajouterAuKit(b, t, o, redessiner) {
  if (t === 'bobines') { choisirBobines(b, o, b.lignes.find(x => x.t === t && x.id === o.id), redessiner); return; }
  const u = t === 'descentes' ? 'tuyaux' : undefined;
  let l = b.lignes.find(x => x.t === t && x.id === o.id && x.u === u);
  const nouveau = !l;
  const avant = l ? (num(l.n) ?? 1) : 0;
  if (!l) { l = { t, id: o.id, n: 1, ...(u ? { u } : {}) }; b.lignes.push(l); } else l.n = avant + 1;
  verifierManque(l, o, () => { if (nouveau) b.lignes.splice(b.lignes.indexOf(l), 1); else l.n = avant; }, redessiner);
}

/** S'il n'y en a pas assez en stock : garder et signaler le manque (rouge vif), mettre ce qu'il y a, ou annuler. */
function verifierManque(l, o, annuler, redessiner) {
  const dispo = disponible(l.t, o, l.u);
  const n = num(l.n) ?? 1;
  if (dispo === null || n <= dispo) { redessiner(); return; }
  const retour = etat.fenetre ? etat.fenetre.firstChild.firstChild : null;
  const fin = () => { if (retour) ouvrirFenetre(retour); else fermerFenetre(); redessiner(); };
  ouvrirFenetre(el('div', {},
    el('h2', {}, 'Il en manque'),
    el('p', {}, `${o.nom || o.ref} : le kit en demande ${nombreJoli(n)}, il n'y en a que ${nombreJoli(dispo)} en stock.`),
    el('button', { class: 'principal', style: 'background:#E0001B;color:#fff', onclick: async () => {
      try { await ecrire(l.t, o.id, { manque: { quand: new Date().toISOString(), par: etat.identifiant, n: n - dispo } }); } catch (e) { alert(e.message); }
      fin();
    } }, `Garder ${nombreJoli(n)} et signaler le manque`),
    dispo > 0 ? el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => { l.n = dispo; fin(); } }, `Mettre seulement ${nombreJoli(dispo)}`) : null,
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => { annuler(); fin(); } }, 'Annuler')));
}

/** Bobines : on choisit lesquelles (les mètres de chacune) ; aucune en stock = un manque. */
function choisirBobines(b, o, l, redessiner) {
  const retour = etat.fenetre ? etat.fenetre.firstChild.firstChild : null;
  const fin = () => { if (retour) ouvrirFenetre(retour); else fermerFenetre(); redessiner(); };
  const m = metres(o);
  if (!m.length) {
    ouvrirFenetre(el('div', {},
      el('h2', {}, 'Aucune bobine en stock'),
      el('p', {}, `${o.nom || o.ref} : il n'y a plus de bobine au dépôt.`),
      el('button', { class: 'principal', style: 'background:#E0001B;color:#fff', onclick: async () => {
        if (!l) b.lignes.push({ t: 'bobines', id: o.id, n: 1 });
        try { await ecrire('bobines', o.id, { manque: { quand: new Date().toISOString(), par: etat.identifiant, n: 1 } }); } catch (e) { alert(e.message); }
        fin();
      } }, 'Garder 1 bobine et signaler le manque'),
      el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fin }, 'Annuler')));
    return;
  }
  const deja = l && Array.isArray(l.bobines) ? l.bobines.map(Number) : [];
  const restantes = [...deja];
  const cases = m.map((x, i) => {
    const j = restantes.indexOf(x);
    const coche = j >= 0;
    if (coche) restantes.splice(j, 1);
    return { metres: x, box: el('input', { type: 'checkbox', checked: coche || (!l && i === 0) }) };
  });
  ouvrirFenetre(el('div', {},
    el('h2', {}, `${o.nom_court || o.nom} : quelles bobines ?`),
    el('p', { class: 'aide' }, 'Coche celles qui partent dans ce kit.'),
    ...cases.map((c, i) => el('label', { class: 'rangee', style: 'font-size:16px;color:var(--encre);font-weight:500' }, c.box, `Bobine ${i + 1} : ${nombreJoli(c.metres)} ml`)),
    el('button', { class: 'principal', onclick: () => {
      const choix = cases.filter(c => c.box.checked).map(c => c.metres);
      if (!choix.length) { if (l) b.lignes.splice(b.lignes.indexOf(l), 1); fin(); return; }
      if (l) { l.n = choix.length; l.bobines = choix; } else b.lignes.push({ t: 'bobines', id: o.id, n: choix.length, bobines: choix });
      fin();
    } }, 'Valider'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fin }, 'Annuler')));
}

// ------------------------------------------------------------------ scanner (appareil photo)

function trouverParCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  let corbeille = null;
  for (const t of ARTICLES) for (const o of etat.donnees[t] || []) {
    if ((o.ref || '').toUpperCase() === c || (o.id || '').toUpperCase() === c) { if (!o.supprime) return { t, o }; corbeille = corbeille || { t, o }; }
  }
  return corbeille;
}

function chargerZXing() {
  return new Promise((ok, ko) => {
    if (window.ZXing) return ok();
    const s = document.createElement('script');
    s.src = 'outils/zxing-0.21.3.min.js';
    s.onload = ok; s.onerror = () => ko(new Error('outil de lecture introuvable'));
    document.head.append(s);
  });
}

/**
 * Ouvre l'appareil photo (celui de derrière) et lit un code-barres ; `surCode` reçoit le code lu.
 * Le navigateur sait parfois lire seul (Android) ; sinon (iPhone, PC) on utilise l'outil libre ZXing rangé dans le site.
 */
async function scanner(surCode) {
  const retour = etat.fenetre ? etat.fenetre.firstChild.firstChild : null;     // ce qui était ouvert (le panier d'un kit)
  const video = el('video', { playsinline: true, muted: true, autoplay: true });
  const msg = el('p', { class: 'aide' }, 'Vise le code-barres de l\'étiquette…');
  let fini = false, flux = null, minuterie = null, lecteur = null;
  const arreter = () => {
    fini = true;
    if (minuterie) clearInterval(minuterie);
    if (lecteur) { try { lecteur.reset(); } catch (e) { /* déjà arrêté */ } }
    if (flux) flux.getTracks().forEach(p => p.stop());
  };
  const revenir = () => { if (retour) ouvrirFenetre(retour); else fermerFenetre(); };
  const trouve = code => {
    if (fini) return;
    arreter();
    if (navigator.vibrate) navigator.vibrate(80);
    revenir();
    surCode(String(code).trim());
  };
  ouvrirFenetre(el('div', { class: 'scanner' },
    el('h2', {}, 'Scanner'),
    el('div', { class: 'viseur' }, video), msg,
    el('button', { class: 'second', style: 'width:100%;margin-top:10px', onclick: () => { arreter(); revenir(); } }, 'Fermer')));
  try {
    let natif = null;
    if ('BarcodeDetector' in window) {
      const voulus = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'upc_a', 'qr_code', 'data_matrix'];
      const ok = await BarcodeDetector.getSupportedFormats().catch(() => []);
      const formats = voulus.filter(f => ok.includes(f));
      if (formats.length) natif = new BarcodeDetector({ formats });
    }
    if (natif) {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = flux;
      await video.play();
      minuterie = setInterval(async () => {
        if (fini || video.readyState < 2) return;
        try { const r = await natif.detect(video); if (r.length) trouve(r[0].rawValue); } catch (e) { /* image suivante */ }
      }, 250);
    } else {
      await chargerZXing();
      lecteur = new ZXing.BrowserMultiFormatReader();
      await lecteur.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, res => { if (res) trouve(res.getText()); });
    }
  } catch (e) {
    msg.textContent = `Appareil photo indisponible : ${e.message}. Il faut autoriser l'appareil photo pour ce site.`;
  }
}

/**
 * Douchette branchée sur un PC (ou lecteur Bluetooth) : elle « tape » le code très vite puis Entrée.
 * Hors d'une case de saisie, ce qu'elle envoie est pris comme un scan : dans un kit ouvert, l'article entre au panier ;
 * sinon, sa fiche s'ouvre.
 */
(() => {
  let tampon = '', dernier = 0;
  document.addEventListener('keydown', ev => {
    const cible = ev.target;
    if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA' || cible.isContentEditable)) return;
    const t = Date.now();
    if (t - dernier > 80) tampon = '';
    dernier = t;
    if (ev.key === 'Enter') {
      if (tampon.length >= 3 && etat.charge) {
        const code = tampon; tampon = '';
        ev.preventDefault();
        codeDouchette(code);
      }
      return;
    }
    if (ev.key.length === 1) tampon += ev.key;
  });
})();

function codeDouchette(code) {
  const kit = etat.kitEnCours;
  if (kit && etat.fenetre) {
    const x = trouverParCode(code);
    if (!x) { alert(`Code inconnu : ${code}`); return; }
    ajouterAuKit(kit.brouillon, x.t, x.o, kit.dessiner);
    return;
  }
  ouvrirArticleScanne(code);
}

/** Code scanné depuis l'en-tête : la fiche de l'article s'ouvre. */
function ouvrirArticleScanne(code) {
  const x = trouverParCode(code);
  if (!x) { alert(`Code inconnu : ${code}`); return; }
  const d = el('div', { class: 'detail', style: 'border-top:0;padding:4px 0' });
  remplirDetail(d, x.t, x.o);
  ouvrirFenetre(el('div', {},
    el('h2', {}, x.o.nom || x.o.ref),
    el('div', { class: 'ref' }, x.o.ref),
    el('div', { class: 'rangee', style: 'margin:8px 0' }, pastille(statut(x.t, x.o)), el('strong', {}, valeurCourte(x.t, x.o) || '—')),
    d,
    el('button', { class: 'second', style: 'width:100%;margin-top:10px', onclick: () => editeurArticle(x.t, x.o) }, '⚙︎ Modifier l\'article'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Fermer')));
}

// ------------------------------------------------------------------ ✎ Idées (les demandes des patrons à Yannick)

/** Sanji, 11/11 : « un bloc-notes pour que les patrons puissent me demander un changement sur le site » ;
 *  « une fois fait, archivé au bout de 7 jours ». */
const SEPT_JOURS = 7 * 24 * 3600 * 1000;
function demandeArchivee(d) {
  if (d.statut !== 'faite' && d.statut !== 'refusee') return false;
  const quand = (d.horodatages && d.horodatages.statut) || d.maj || d.cree_le;
  return quand && (Date.now() - new Date(quand).getTime()) > SEPT_JOURS;
}
const STATUTS_DEMANDE = { nouvelle: ['Nouvelle', 'p-COMPTER'], faite: ['Faite ✓', 'p-OK'], refusee: ['Pas retenue', 'p-DECIDER'] };

function carteDemande(d) {
  const [lib, cls] = STATUTS_DEMANDE[d.statut] || STATUTS_DEMANDE.nouvelle;
  return el('div', { class: 'carte' },
    el('div', { class: 'rangee' }, el('span', { class: `pastille ${cls}` }, lib),
      el('span', { class: 'aide etire' }, `${d.demande_par || '?'} · le ${jourHeure(d.cree_le || d.maj)}`)),
    el('div', { style: 'white-space:pre-wrap;margin-top:6px' }, d.texte || ''),
    d.dessin && /^data:image\/(png|jpeg);base64,/.test(d.dessin) ? el('img', { src: d.dessin, alt: 'Dessin', class: 'dessin' }) : null,
    d.reponse ? el('div', { style: 'margin-top:8px;color:var(--accent)' }, `Réponse de Yannick : ${d.reponse}`) : null,
    d.statut === 'nouvelle' && d.demande_par === etat.identifiant ? el('div', { class: 'rangee', style: 'margin-top:8px' },
      el('button', { class: 'petit danger', onclick: async () => {
        if (!confirm('Retirer cette demande ?')) return;
        try { await ecrire('demandes', d.id, { supprime: true }); principal('idees'); } catch (e) { alert(e.message); }
      } }, 'Retirer')) : null);
}

/**
 * Un petit carnet à dessin (Sanji : « la possibilité de dessiner dans le bloc-notes ») : au doigt ou à la souris,
 * 4 couleurs, gomme, tout effacer. Rend { vue, image() } : image() = le dessin en PNG (texte), ou null s'il est vide.
 */
function ardoise() {
  const canvas = el('canvas', { class: 'ardoise' });
  const ctx = canvas.getContext('2d');
  let couleur = '#1A2227', epaisseur = 4, dessine = false, vide = true, dernier = null;
  function taille() {
    const l = Math.min(canvas.parentElement ? canvas.parentElement.clientWidth : 600, 900) || 600;
    const r = window.devicePixelRatio || 1;
    canvas.style.width = l + 'px'; canvas.style.height = Math.round(l * 0.7) + 'px';
    canvas.width = Math.round(l * r); canvas.height = Math.round(l * 0.7 * r);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, l, l * 0.7);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    vide = true;
  }
  const point = ev => { const b = canvas.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  canvas.addEventListener('pointerdown', ev => { dessine = true; dernier = point(ev); canvas.setPointerCapture(ev.pointerId); ev.preventDefault(); });
  canvas.addEventListener('pointermove', ev => {
    if (!dessine) return;
    const p = point(ev);
    ctx.strokeStyle = couleur; ctx.lineWidth = couleur === '#FFFFFF' ? 22 : epaisseur;
    ctx.beginPath(); ctx.moveTo(dernier[0], dernier[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    dernier = p; vide = false; ev.preventDefault();
  });
  const fin = () => { dessine = false; };
  canvas.addEventListener('pointerup', fin); canvas.addEventListener('pointercancel', fin);
  const outils = el('div', { class: 'rangee', style: 'margin:6px 0' },
    ...[['#1A2227', 'Noir'], ['#E0001B', 'Rouge'], ['#1F5FD0', 'Bleu'], ['#2B7552', 'Vert']].map(([c, nom]) =>
      el('button', { class: 'petit', title: nom, style: `color:${c};background:#FFFFFF;font-weight:800`, onclick: () => { couleur = c; } }, '● ' + nom)),
    el('button', { class: 'petit', onclick: () => { couleur = '#FFFFFF'; } }, 'Gomme'),
    el('button', { class: 'petit danger', onclick: taille }, 'Tout effacer'));
  const vue = el('div', {}, outils, canvas);
  requestAnimationFrame(taille);
  return {
    vue,
    image() {
      if (vide) return null;
      // On réduit à 900 points de large au plus, en PNG (un dessin au trait reste léger)
      const l = Math.min(900, canvas.width), h = Math.round(canvas.height * l / canvas.width);
      const c2 = document.createElement('canvas'); c2.width = l; c2.height = h;
      c2.getContext('2d').drawImage(canvas, 0, 0, l, h);
      return c2.toDataURL('image/png');
    },
  };
}

function pageIdees(corps) {
  const texte = el('textarea', { placeholder: 'Ce que tu aimerais changer, ajouter ou enlever sur le site…', style: 'min-height:110px' });
  const msg = el('p', { class: 'erreur' });
  let dessin = null;
  const zoneDessin = el('div');
  const boutonDessin = el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => {
    if (dessin) { dessin = null; vider(zoneDessin); boutonDessin.textContent = '✏ Ajouter un dessin'; return; }
    dessin = ardoise(); zoneDessin.append(dessin.vue); boutonDessin.textContent = 'Enlever le dessin';
  } }, '✏ Ajouter un dessin');
  const toutes = tous('demandes').sort((a, b) => (b.cree_le || '').localeCompare(a.cree_le || ''));
  const actives = toutes.filter(d => !demandeArchivee(d));
  const archivees = toutes.filter(demandeArchivee);
  corps.append(
    el('p', { class: 'aide' }, 'Un bloc-notes pour Yannick : une idée, un changement, un truc à ajouter ou à enlever sur le site. Il te répond ici. Une demande faite part aux archives au bout de 7 jours.'),
    texte, boutonDessin, zoneDessin, msg,
    el('button', { class: 'principal', onclick: async ev => {
      const t = texte.value.trim();
      const image = dessin ? dessin.image() : null;
      if (!t && !image) { msg.textContent = 'Écris ta demande (ou fais un dessin) d\'abord.'; return; }
      if (image && image.length > 1400000) { msg.textContent = 'Le dessin est trop lourd : efface un peu et recommence.'; return; }
      ev.target.disabled = true;
      try {
        const id = `D-${Date.now().toString(36)}-${hex(2)}`;
        await ecrire('demandes', id, { texte: t.slice(0, 2000), dessin: image, statut: 'nouvelle', demande_par: etat.identifiant, supprime: false, cree_le: new Date().toISOString() });
        await rafraichir();
      } catch (e) { msg.textContent = e.message; ev.target.disabled = false; }
    } }, 'Envoyer à Yannick'),
    el('div', { class: 'titre-section' }, `Demandes (${actives.length})`));
  if (!actives.length) corps.append(el('p', { class: 'aide' }, 'Aucune demande en cours.'));
  actives.forEach(d => corps.append(carteDemande(d)));
  if (archivees.length) {
    const det = el('details', { class: 'dossier', style: 'margin-top:12px' }, el('summary', {}, `Archivées (${archivees.length})`));
    archivees.forEach(d => det.append(el('div', { style: 'padding:0 10px' }, carteDemande(d))));
    corps.append(det);
  }
}

// ------------------------------------------------------------------ Comptes

async function pageComptes(corps) {
  // Type d'affichage du stock (retenu sur cet appareil)
  const choixAffichage = el('div', { class: 'puces' }, [['tableau', 'Tableau (façon Excel)'], ['dossiers', 'Dossiers']].map(([k, lib]) =>
    el('button', { class: affichageStock() === k ? 'actif' : '', onclick: () => { ecrireStockage('sd_affichage', k); principal('comptes'); } }, lib)));
  corps.append(
    el('h2', { style: 'margin:4px 0 0' }, '⚙︎ Réglages'),
    el('div', { class: 'titre-section', style: 'margin-top:12px' }, 'Type d\'affichage du stock'),
    choixAffichage,
    el('p', { class: 'aide' }, 'Tableau : une ligne par article, en colonnes ; les zones se plient et se déplient. Dossiers : des cartes par zone. Le choix est retenu sur cet appareil.'),
    el('div', { class: 'titre-section' }, 'Comptes du site'));
  corps.append(el('p', { class: 'aide' }, 'Les comptes du site. Pour un oubli : donne un mot de passe provisoire (à dire à l\'oral) ; la personne choisira le sien en se connectant. Personne ne peut lire un mot de passe.'));
  const liste = el('div', {}, el('p', { class: 'aide' }, 'Chargement…'));
  corps.append(liste,
    el('button', { class: 'principal', onclick: () => fenetreCompte(null) }, '+ Nouveau compte'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => ecranChangement(false) }, 'Changer mon mot de passe ou mon identifiant'),
    // Sanji, 11/11 : « Sortir » devient « Déconnexion », en bas de Comptes
    el('button', { class: 'second danger', style: 'width:100%;margin-top:24px', onclick: () => {
      if (confirm('Te déconnecter de cet appareil ? Il faudra retaper ton identifiant et ton mot de passe.')) seDeconnecter();
    } }, 'Déconnexion'));
  try {
    const r = await rpc('liste_comptes', moi());
    vider(liste);
    if (!r.ok) { liste.append(el('p', { class: 'erreur' }, r.message)); return; }
    (r.comptes || []).forEach(c => liste.append(el('div', { class: 'carte' },
      el('div', { style: 'font-weight:700' }, c.identifiant + (c.moi ? ' (moi)' : '')),
      el('div', { class: 'aide' }, [c.a_changer ? 'doit encore choisir son mot de passe' : 'mot de passe choisi', c.appareils ? `connecté sur ${c.appareils} appareil(s)` : null, c.cree_par ? `créé par ${c.cree_par}` : null].filter(Boolean).join(' · ')),
      c.moi ? null : el('div', { class: 'rangee', style: 'margin-top:8px' },
        el('button', { class: 'petit', onclick: () => fenetreCompte(c) }, 'Mot de passe provisoire'),
        el('button', { class: 'petit danger', onclick: async () => {
          if (!confirm(`Retirer le compte « ${c.identifiant} » ? Il ne pourra plus se connecter.`)) return;
          const x = await rpc('desactiver_compte', { ...moi(), p_compte: c.id }); alert(x.message); principal('comptes');
        } }, 'Retirer')))));
  } catch (e) { vider(liste).append(el('p', { class: 'erreur' }, e.message)); }
}

function fenetreCompte(c) {
  const ident = el('input', { type: 'text', autocapitalize: 'words', placeholder: 'Prénom' });
  const mdp = el('input', { type: 'text', autocomplete: 'off', placeholder: '6 caractères au moins' });
  const msg = el('p', { class: 'erreur' });
  ouvrirFenetre(el('div', {},
    el('h2', {}, c ? `Mot de passe oublié : ${c.identifiant}` : 'Nouveau compte'),
    el('p', { class: 'aide' }, 'Tu lui donneras le mot de passe provisoire à l\'oral ; il le changera à sa connexion.'),
    c ? null : el('label', {}, 'Identifiant (son prénom)'), c ? null : ident,
    el('label', {}, 'Mot de passe provisoire'), mdp, msg,
    el('button', { class: 'principal', onclick: async () => {
      try {
        const r = c ? await rpc('reinitialiser_compte', { ...moi(), p_compte: c.id, p_provisoire: mdp.value })
                    : await rpc('creer_compte', { ...moi(), p_identifiant: ident.value.trim(), p_provisoire: mdp.value });
        if (!r.ok) { msg.textContent = r.message; return; }
        fermerFenetre(); alert(r.message); principal('comptes');
      } catch (e) { msg.textContent = e.message; }
    } }, 'Enregistrer'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Annuler')));
}

demarrer();
