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
// carnet : les fournisseurs (⚙ Modifier l'article) et les employés (kits déploiement)
const TABLES = ['accessoires', 'bobines', 'descentes', 'zones', 'reglages', 'kits', 'demandes', 'carnet', 'deploiements'];
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

/** Plusieurs écritures d'un coup (un départ ou un retour de déploiement : les articles et le déploiement ensemble). */
async function ecrireLot(lot) {
  if (!lot.length) return;
  const ts = new Date().toISOString();
  const r = await rpc('appliquer_modifications', {
    modifs: lot.map(x => ({ table: x.table, id: x.id, champs: x.champs, ts, par: etat.identifiant, appareil: APP.id })),
    p_jeton: APP.jeton,
  });
  const res = (r && r.resultats) || [];
  const erreurs = res.filter(x => x.erreur).map(x => `${x.id} : ${x.erreur}`);
  lot.forEach((x, i) => {
    if (res[i] && res[i].erreur) return;
    const liste = etat.donnees[x.table] || (etat.donnees[x.table] = []);
    let o = liste.find(y => y.id === x.id);
    if (!o) { o = { id: x.id }; liste.push(o); }
    Object.assign(o, x.champs);
  });
  if (!res.length) throw new Error('Pas de réponse du document');
  if (erreurs.length) throw new Error('Pas tout enregistré : ' + erreurs.join(' ; '));
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
  return `Il a manqué ${m.n ? nombreJoli(num(m.n)) + ' ' : ''}pour ${m.dep ? 'un départ' : 'un kit'}, le ${jourHeure(m.quand)}${m.par ? ' (' + m.par + ')' : ''}`;
}

function valeurCourte(tab, o) {
  if (tab === 'bobines') {
    const m = metres(o), s = sorties(o).length;
    const b = m.length ? `${m.length} bobine${m.length > 1 ? 's' : ''} · ${nombreJoli(m.reduce((a, x) => a + x, 0))} ml` : null;
    return s ? `${b || '0 bobine'} · ${s} sortie${s > 1 ? 's' : ''}` : b;
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
    // Kits déploiement (départs et retours par employé)
    case 'depart': return (m.bobines ? `Parti : ${n} bobine(s) (${mm} ml)` : `Parti : −${n}${unite}`) + qui + (m.motif ? ` · ${m.motif}` : '')
      + (m.niveau_inchange ? ' (niveau inchangé)' : '');
    case 'depart_retour': return m.annule ? `Départ annulé : tout revient${qui}`
      : m.bobines ? `Retour : ${nombreJoli(num(m.retour) || 0)} ml revenus sur ${mm} ml${qui}` : `Retour : +${n}${unite}${qui}`;
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
    etat.admin = !!e.admin;          // la coche admin : comptes, coches admin (réservés aux admins)
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
// Sanji, 12/11 : le carnet (fournisseurs et employés) « entre Kits et Idées »
// 📈 Graphiques (Sanji, 12/11 : « un nouvel onglet graphique ») : graphiques.js
const ONGLETS = [['stock', 'Stock'], ['signaler', '⚠'], ['graphiques', '📈'], ['kits', 'Kits'], ['carnet', 'Carnet'], ['idees', '✎ Idées']];

function principal(onglet) {
  // Sanji : « quand je clique sur un nom de colonne pour trier, il me redécale tout à gauche » : on garde la place
  // (la page, et le défilement de chaque tableau) quand on redessine le même onglet
  const memeOnglet = etat.onglet === (onglet || 'stock') && !!document.querySelector('main');
  const yAvant = window.scrollY;
  const cadresAvant = [...document.querySelectorAll('.tableau-cadre')].map(c => [c.scrollLeft, c.scrollTop]);
  etat.onglet = onglet || 'stock';
  principalDessiner();
  if (memeOnglet) {
    [...document.querySelectorAll('.tableau-cadre')].forEach((c, i) => { if (cadresAvant[i]) { c.scrollLeft = cadresAvant[i][0]; c.scrollTop = cadresAvant[i][1]; } });
    window.scrollTo(0, yAvant);
  }
}

function principalDessiner() {
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
  ({ stock: pageStock, signaler: pageSignaler, graphiques: pageGraphiques, kits: pageKits, carnet: pageCarnet, idees: pageIdees, comptes: pageComptes })[etat.onglet](corps);
}

async function rafraichir() {
  try { await chargerTout(); principal(etat.onglet); }
  catch (e) { if (/autoris/i.test(e.message)) demarrer(); else alert(e.message); }
}

// Relecture toutes les 2 minutes quand la page est à l'écran (et qu'aucune fenêtre n'est ouverte)
setInterval(() => {
  if (document.visibilityState === 'visible' && etat.charge && !etat.fenetre && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) rafraichir();
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
    el('div', { class: 'valeur' }, el('div', {}, t === 'bobines' ? celluleBobines(o) : (valeurCourte(t, o) || '—')), pastille(s)),
    surAjout ? null : boutonHorloge(t, o),
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

  // Couleur (tous) ; bobines et descentes : largeur ou diamètre (« Autre… » ouvre un champ libre) ; accessoires : dimension libre
  let groupe = null, groupeAutre = null, dimension = null;
  const listeCouleurs = el('datalist', { id: 'couleurs-connues' },
    [...new Set(ARTICLES.flatMap(x => tous(x).map(a => a.couleur)).filter(Boolean))].sort(triFr).map(c => el('option', { value: c })));
  const couleur = champ(o.couleur ?? (t === 'accessoires' ? couleurDe(t, o) : null), 'ex. Anthracite 7016', { list: 'couleurs-connues', autocomplete: 'off' });
  const titreGroupe = t === 'bobines' ? 'Largeur' : 'Diamètre';
  if (t === 'accessoires') dimension = champ(o.dimension, 'ex. Ø80, G300, 33, 5x30 (facultatif)');
  else {
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
    valeurs.couleur = net(couleur.value);
    if (t === 'accessoires') {
      valeurs.dimension = net(dimension.value);
      valeurs.famille = famille.value || null;
      valeurs.mode = mode;
      if (mode !== 'niveau') { valeurs.unite = unite.value || null; valeurs.par_carton = pc; valeurs.seuil = s; }   // en niveau, on n'y touche pas
    } else {
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
    el('label', {}, 'Couleur'), couleur, listeCouleurs,
    groupe ? [el('label', {}, titreGroupe), groupe, groupeAutre] : null,
    dimension ? [el('label', {}, 'Dimension'), dimension] : null,
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
    // Bobines (Sanji : « le détail des bobines, je ne suis pas fan ») : une jauge par bobine, au lieu de « 65 + 15 + 10 = … »
    t === 'bobines' && (metres(o).length || sorties(o).length) ? jaugesBobines(o) : el('div', {}, resume(t, o) || 'Pas encore compté'),
    o.compte ? el('div', {}, `Compté le ${jourHeure(o.compte)}${o.compte_par ? ' par ' + o.compte_par : ''}`) : null,
    o.mouvement ? el('div', {}, `Dernier mouvement : ${mouvementTexte(o.mouvement)}, le ${jourHeure(o.mouvement.quand)}`) : null,
    t !== 'bobines' && sorties(o).length ? el('div', {}, 'Sorties : ' + sorties(o).map(x => `${nombreJoli(num(x.m))} ml (${x.ouvrier || '?'})`).join(', ')) : null,
    o.fournisseur ? el('div', {}, `Fournisseur : ${o.fournisseur}`) : null,
    o.note ? el('div', {}, `Note : ${o.note}`) : null,
    enAlerte(s) ? el('div', { class: 'rangee', style: 'margin-top:8px' }, boutonVu(t, o), o.manque ? boutonManqueRegle(t, o) : null) : null);
}

/** La longueur d'une bobine neuve de cette largeur (réglage « longueur_bobine_neuve_m » : un nombre, ou par largeur). */
function longueurNeuve(o) {
  const r = reglage('longueur_bobine_neuve_m');
  if (typeof r === 'number') return r;
  if (r && typeof r === 'object') { const v = num(r[String(parseInt(o.groupe, 10))]); if (v) return v; }
  return Math.max(60, ...metres(o));
}

/** Chaque bobine en jauge : remplie selon ce qui reste par rapport à une neuve ; orange sous le seuil ; les sorties en gris. */
function jaugesBobines(o) {
  const neuve = longueurNeuve(o);
  const seuil = num(o.seuil);
  const m = metres(o).slice().sort((a, b) => b - a);
  const total = m.reduce((a, x) => a + x, 0);
  const jauge = (metresBobine, classe, etiquette) => el('div', { class: 'jauge' + (classe ? ' ' + classe : '') },
    el('span', { class: 'barre' }, el('i', { style: `width:${Math.max(3, Math.min(100, metresBobine / neuve * 100))}%` })),
    el('span', { class: 'm' }, `${nombreJoli(metresBobine)} ml`),
    etiquette ? el('span', { class: 'aide' }, etiquette) : null);
  return el('div', { class: 'jauges' },
    el('div', { style: 'font-weight:700;color:var(--encre)' },
      m.length ? `${m.length} bobine${m.length > 1 ? 's' : ''} au dépôt · ${nombreJoli(total)} ml en tout` : 'Aucune bobine au dépôt'),
    el('div', { class: 'aide' }, `Une neuve fait ${nombreJoli(neuve)} ml` + (seuil !== null ? ` · alerte s'il n'en reste aucune d'au moins ${nombreJoli(seuil)} ml` : '')),
    m.map(x => jauge(x, seuil !== null && x < seuil ? 'basse' : null, null)),
    sorties(o).length ? el('div', { style: 'margin-top:6px;font-weight:600;color:var(--encre)' }, 'Sorties (chez un employé)') : null,
    sorties(o).map(s => jauge(num(s.m) ?? 0, 'sortie', `${s.ouvrier || 'personne de précis'}${s.depuis ? ', depuis le ' + jour(s.depuis) : ''}`)));
}

/** La case Stock d'une bobine dans le tableau : le texte, et une petite barre par bobine (plus haute = plus longue). */
function celluleBobines(o) {
  const neuve = longueurNeuve(o), seuil = num(o.seuil);
  const m = metres(o).slice().sort((a, b) => b - a);
  return el('span', { class: 'cellule-bobines' }, valeurCourte('bobines', o) || '—',
    m.length ? el('span', { class: 'mini-bobines', title: m.map(x => nombreJoli(x) + ' ml').join(' · ') },
      m.map(x => el('i', { class: seuil !== null && x < seuil ? 'basse' : null, style: `height:${Math.max(12, Math.min(100, x / neuve * 100))}%` }))) : null);
}

// ------------------------------------------------------------------ 🕐 Historique (Sanji, 12/11)

/* Sanji : « oui pour le site, avec une 🕐 sur chaque item, et une autre pour tout voir ».
 * Le document garde chaque changement des articles (table historique) : qui, quand, d'où, avant → après.
 * 🕐 d'un article : lire_historique (ses 200 derniers changements) ; 🕐 Historique (barre du Stock) : lire_historique_stock
 * (tout le stock, par pages de 100, filtres par type et par personne). Les mêmes phrases que le 🕘 de l'appli (Edition.kt). */
const CASES_HISTO = { nom: 'Nom', nom_court: 'Nom court', ref: 'Référence', zone: 'Emplacement', famille: 'Famille',
  fournisseur: 'Fournisseur', mode: 'Façon de compter', unite: 'Unité', seuil: 'Seuil', signaler: 'Alerte', note: 'Note',
  couleur: 'Couleur', quantite: 'Quantité', niveau: 'Niveau', metres: 'Mètres', cartons: 'Cartons', tuyaux: 'Tuyaux' };
const IGNOREES_HISTO = new Set(['compte', 'compte_par', 'compte_appareil', 'ordre', 'g_ordre', 'suivi', 'alerte_vue_par', 'horodatages',
  'maj', 'maj_par', 'maj_appareil', 'maj_serveur', 'cree_le', 'stock_max']);
const COMPTES_HISTO = ['quantite', 'niveau', 'metres', 'cartons', 'tuyaux'];
const fmtJourLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function nomCaseHisto(t, k) {
  if (k === 'par_carton') return t === 'descentes' ? 'Tuyaux par carton' : 'Contenance';
  if (k === 'groupe') return t === 'bobines' ? 'Largeur' : 'Diamètre';
  return CASES_HISTO[k] || k;
}
function valeurHisto(k, v) {
  if (v === null || v === undefined) return '—';
  if (k === 'niveau') return niveauLibelle(v);
  if (k === 'mode') return v === 'niveau' ? 'niveau' : v === 'mixte' ? 'mixte' : 'quantité';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'number') return nombreJoli(v);
  if (Array.isArray(v)) return v.length ? v.map(x => nombreJoli(num(x))).join(' + ') : 'aucune';
  if (typeof v === 'object') return '…';
  return String(v);
}
/** Les phrases d'un changement ; null = rien de lisible (seulement des cases techniques : rangement, dates…). */
function descriptionsHisto(t, o, h) {
  if (h.action === 'creation') return ['Créé'];
  if (h.action === 'suppression') return ['Mis à la corbeille'];
  if (h.action === 'restauration') return ['Ressorti de la corbeille'];
  const c = h.changements || {};
  const lignes = [];
  // Un comptage : ce qui a été compté, écrit comme dans le détail (les valeurs de ce moment-là)
  if (h.est_comptage || h.action === 'comptage') {
    const copie = { ...(o || {}), ...(h.valeurs || {}) };
    Object.entries(c).forEach(([k, ch]) => { if (ch && typeof ch === 'object' && 'apres' in ch) copie[k] = ch.apres; });
    lignes.push('Comptage : ' + (resume(t, copie) || '—'));
  }
  // Un mouvement (entrée, sortie, départ, retour, kit) : sa phrase, et ce qui reste
  const mvt = c.mouvement && c.mouvement.apres && typeof c.mouvement.apres === 'object' ? c.mouvement.apres : null;
  if (mvt) {
    lignes.push(mouvementTexte(mvt));
    const k = t === 'bobines' ? null : ['quantite', 'cartons', 'tuyaux'].find(x => c[x]);
    if (k) lignes.push(`${nomCaseHisto(t, k)} : ${valeurHisto(k, c[k].avant)} → ${valeurHisto(k, c[k].apres)}`);
  }
  Object.entries(c).forEach(([k, ch]) => {
    if (!ch || typeof ch !== 'object' || k === 'mouvement' || k === 'sorties' || IGNOREES_HISTO.has(k)) return;
    if (COMPTES_HISTO.includes(k) && (mvt || lignes.length)) return;     // déjà dit par le mouvement ou le comptage
    if (k === 'supprime') lignes.push(ch.apres === true ? 'Mis à la corbeille' : 'Ressorti de la corbeille');
    else if (k === 'alerte_vue') lignes.push(ch.apres ? 'Coché « Vu »' : '« Vu » retiré');
    else if (k === 'manque') lignes.push(ch.apres ? 'Il a manqué (kit ou départ)' : 'Manque réglé');
    else lignes.push(`${nomCaseHisto(t, k)} : ${valeurHisto(k, ch.avant)} → ${valeurHisto(k, ch.apres)}`);
  });
  return lignes.length ? lignes : null;
}
function origineHisto(h) {
  if (h.source === 'import') return 'repris de l\'ancien tableau';
  if (h.source === 'claude') return 'via Claude';
  if (h.source === 'sql') return 'réglage direct';
  if (h.appareil && String(h.appareil).startsWith('WEB-')) return 'site';
  return h.source === 'appli' ? 'appli' : (h.appareil || h.source || '');
}
/** Ajoute les changements à la liste, rangés par jour (le jour du dernier déjà montré est rendu, pour continuer). */
function dessinerHisto(liste, lignes, avecArticle, jourAvant) {
  let jourCourant = jourAvant || null;
  let caches = 0;
  lignes.forEach(h => {
    const t = h.table_nom;
    const o = avecArticle ? trouver(t, h.ligne_id) : h.article;
    const phrases = descriptionsHisto(t, o, h);
    if (!phrases) { caches++; return; }
    const d = new Date(h.quand);
    const j = fmtJourLong.format(d);
    if (j !== jourCourant) { liste.append(el('div', { class: 'histo-jour' }, j)); jourCourant = j; }
    liste.append(el('div', { class: 'histo' },
      el('div', { class: 'histo-tete' }, el('b', {}, fmtHeure.format(d)), ` · ${h.par || '?'}`, el('span', { class: 'aide' }, ' · ' + origineHisto(h))),
      avecArticle ? el('div', { class: 'histo-article' }, (o && (o.nom_court || o.nom)) || h.nom || h.ref || h.ligne_id,
        el('span', { class: 'aide', style: 'font-weight:400' }, '  ' + (h.ref || ''))) : null,
      el('ul', {}, phrases.map(p => el('li', {}, p)))));
  });
  return { jour: jourCourant, caches };
}

/** 🕐 d'un article : ses changements, du plus récent au plus ancien. */
function boutonHorloge(t, o) {
  return el('button', { class: 'horloge', type: 'button', title: 'Historique de l\'article', 'aria-label': 'Historique de l\'article',
    onclick: ev => { ev.stopPropagation(); fenetreHistorique(t, o); } }, '🕐');
}
async function fenetreHistorique(t, o) {
  const liste = el('div', {}, el('p', { class: 'aide' }, 'Chargement…'));
  ouvrirFenetre(el('div', {},
    el('h2', {}, '🕐 ' + (o.nom_court || o.nom || o.ref)),
    el('p', { class: 'aide' }, `${o.ref || ''} · qui a compté ou changé quoi, et quand (le plus récent en haut)`),
    liste,
    el('button', { class: 'second', style: 'width:100%;margin-top:12px', onclick: fermerFenetre }, 'Fermer')));
  try {
    const r = await rpc('lire_historique', { ...moi(), p_table: t, p_id: o.id, p_limite: 200 });
    vider(liste);
    if (!r.ok) { liste.append(el('p', { class: 'erreur' }, r.message)); return; }
    const l = (r.lignes || []).map(h => ({ ...h, table_nom: t, article: o }));
    const { caches } = dessinerHisto(liste, l, false);
    if (!liste.childElementCount) liste.append(el('p', { class: 'aide' }, 'Rien de noté pour cet article.'));
    if (caches) liste.append(el('p', { class: 'aide', style: 'margin-top:8px' }, `(${caches} changement${caches > 1 ? 's' : ''} de rangement non montré${caches > 1 ? 's' : ''})`));
    if (l.length >= 200) liste.append(el('p', { class: 'aide' }, 'Seuls les 200 derniers changements sont montrés.'));
  } catch (e) { vider(liste).append(el('p', { class: 'erreur' }, e.message)); }
}

/** 🕐 Historique (barre du Stock) : tout le stock, rangé par jour ; filtres par type et par personne ; « Voir plus ancien ». */
function fenetreHistoriqueStock() {
  const TYPES = [[null, 'Tout'], ['comptages', 'Comptages'], ['mouvements', 'Entrées et sorties'], ['modifications', 'Modifications']];
  const f = { type: null, qui: null };
  const puces = el('div', { class: 'puces' });
  const qui = el('select', { onchange: () => { f.qui = qui.value || null; recharger(); } }, el('option', { value: '' }, 'Tout le monde'));
  const liste = el('div');
  const pied = el('div');
  let suite = null, jour = null, charge = 0, tour = 0;     // tour : un filtre changé pendant un chargement l'annule
  function dessinerPuces() {
    vider(puces).append(...TYPES.map(([k, lib]) => el('button', { class: f.type === k ? 'actif' : '', onclick: () => { f.type = k; dessinerPuces(); recharger(); } }, lib)));
  }
  async function page() {
    const ce = tour;
    vider(pied).append(el('p', { class: 'aide' }, 'Chargement…'));
    try {
      const r = await rpc('lire_historique_stock', { ...moi(), p_avant: suite ? suite.quand : null, p_avant_id: suite ? suite.id : null,
        p_limite: 100, p_qui: f.qui, p_type: f.type });
      if (ce !== tour) return;
      vider(pied);
      if (!r.ok) { pied.append(el('p', { class: 'erreur' }, r.message)); return; }
      if (Array.isArray(r.personnes) && qui.options.length === 1) r.personnes.forEach(p => qui.append(el('option', { value: p }, p)));
      const l = r.lignes || [];
      jour = dessinerHisto(liste, l, true, jour).jour;
      charge += l.length;
      if (!liste.childElementCount && l.length < 100) liste.append(el('p', { class: 'aide' }, f.type === 'mouvements'
        ? 'Aucune entrée ni sortie notée pour l\'instant (elles arrivent avec les kits, les départs et les ± de l\'appli).' : 'Rien pour l\'instant.'));
      if (l.length >= 100) {
        suite = l[l.length - 1];
        pied.append(el('button', { class: 'second', style: 'width:100%;margin-top:10px', onclick: page }, 'Voir plus ancien'));
      } else if (charge) pied.append(el('p', { class: 'aide', style: 'margin-top:8px' }, 'C\'est tout : le document garde l\'historique depuis le 6 novembre 2026.'));
    } catch (e) { if (ce === tour) vider(pied).append(el('p', { class: 'erreur' }, e.message)); }
  }
  function recharger() { tour++; suite = null; jour = null; charge = 0; vider(liste); page(); }
  dessinerPuces();
  ouvrirFenetre(el('div', {},
    el('h2', {}, '🕐 Historique du stock'),
    el('p', { class: 'aide' }, 'Tout ce qui a été compté ou changé, par qui et quand (le plus récent en haut). Le 🕐 d\'un article montre le sien.'),
    puces,
    el('label', {}, 'Qui'), qui,
    liste, pied,
    el('button', { class: 'second', style: 'width:100%;margin-top:12px', onclick: fermerFenetre }, 'Fermer')));
  page();
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

/** Les filtres du Stock : clé, titre, et les valeurs d'un article (une couleur « A / B » compte pour les deux teintes). */
const FILTRES_STOCK = [
  ['famille', 'Famille', (t, o) => [t === 'accessoires' ? o.famille : t === 'bobines' ? 'Bobines' : 'Descentes']],
  ['teinte', 'Couleur', (t, o) => teintesDe(t, o)],
  ['dimension', 'Dimension', (t, o) => [dimensionDe(t, o)]],
  ['fournisseur', 'Fournisseur', (t, o) => [o.fournisseur]],
  ['zone', 'Emplacement', (t, o) => [o.zone]],
];

function libelleFiltre(k, v) {
  if (k !== 'zone') return v;
  const z = tous('zones').find(x => x.id === v);
  return z && z.libelle ? `${v} · ${z.libelle}` : v;
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
  // Plus de filtres (Sanji, 12/11 : « plus de filtres ») : famille, couleur, dimension, fournisseur, emplacement.
  // Chaque liste ne propose que ce qui existe avec les autres filtres déjà choisis (Coudes → Ø80, Ø100).
  etat.filtres = etat.filtres || {};
  const filtresZone = el('div', { class: 'filtres' });
  const passeAutres = (x, sauf) => FILTRES_STOCK.every(([k, , f]) => k === sauf || !etat.filtres[k] || f(x.t, x.o).includes(etat.filtres[k]));
  function dessinerFiltres() {
    vider(filtresZone);
    FILTRES_STOCK.forEach(([k, lib, f]) => {
      const compte = new Map();
      tousArticles.filter(x => passeAutres(x, k)).forEach(x => f(x.t, x.o).filter(Boolean).forEach(v => compte.set(v, (compte.get(v) || 0) + 1)));
      if (etat.filtres[k] && !compte.has(etat.filtres[k])) compte.set(etat.filtres[k], 0);
      const valeurs = [...compte.keys()].sort((a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));
      const s = el('select', { class: etat.filtres[k] ? 'actif' : '', 'aria-label': lib, onchange: () => {
        if (s.value) etat.filtres[k] = s.value; else delete etat.filtres[k];
        dessinerFiltres(); dessiner();
      } }, el('option', { value: '' }, `${lib} : tout`), valeurs.map(v => el('option', { value: v }, `${lib} : ${libelleFiltre(k, v)} (${compte.get(v)})`)));
      s.value = etat.filtres[k] || '';
      filtresZone.append(s);
    });
    if (Object.keys(etat.filtres).length) filtresZone.append(el('button', { class: 'petit', onclick: () => { etat.filtres = {}; dessinerFiltres(); dessiner(); } }, '✕ Effacer les filtres'));
  }
  function garde(t, o) {
    const s = statut(t, o);
    if (etat.filtre === 'signaler' && !enAlerte(s)) return false;
    if (etat.filtre === 'compter' && s !== 'COMPTER') return false;
    if (!passeAutres({ t, o }, null)) return false;
    const mots = normaliser(etat.recherche).split(/\s+/).filter(Boolean);
    if (!mots.length) return true;
    const h = normaliser([o.ref, o.nom, o.nom_court, o.zone, o.fournisseur, o.famille, couleurDe(t, o), dimensionDe(t, o)].join(' '));
    return mots.every(m => h.includes(m));
  }
  const toutOuvrir = () => etat.filtre !== 'tous' || etat.recherche.trim() !== '' || Object.keys(etat.filtres).length > 0;
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
    // On garde la place de chaque tableau (défilement de côté et vers le bas) quand on le redessine (tri, dépliage, case modifiée)
    const cadresAvant = [...liste.querySelectorAll('.tableau-cadre')].map(c => [c.scrollLeft, c.scrollTop]);
    const yAvant = window.scrollY;
    dessinerListe();
    [...liste.querySelectorAll('.tableau-cadre')].forEach((c, i) => { if (cadresAvant[i]) { c.scrollLeft = cadresAvant[i][0]; c.scrollTop = cadresAvant[i][1]; } });
    if (cadresAvant.length) window.scrollTo(0, yAvant);
  }
  etat.redessinerStock = dessiner;
  function dessinerListe() {
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
  dessinerPuces(); dessinerFiltres(); dessiner();
  // « + Nouvel article » (ajouter une ligne) ; en tableau, « ☰ Colonnes » (la disposition de chacun)
  const outils = ajouterA(el('div', { class: 'rangee outils-stock', style: 'margin-bottom:10px' }),
    el('button', { class: 'second etire', onclick: nouvelArticle }, '+ Nouvel article'),
    // Sanji, 12/11 : « … et une autre pour tout voir » : l'historique de tout le stock
    el('button', { class: 'second', title: 'Historique de tout le stock', onclick: fenetreHistoriqueStock }, '🕐 Historique'),
    // Sanji : « en Excel, la roue crantée c'est pour ajouter des colonnes et autres réglages »
    el('button', { class: 'second', onclick: () => fenetreColonnes(() => principal('stock')) }, affichageStock() === 'tableau' ? '⚙︎ Colonnes' : '⚙︎ Affichage'),
    // Sanji : « la possibilité de changer plusieurs cases d'une colonne en une fois »
    affichageStock() === 'tableau' ? el('button', { class: etat.selection ? 'principal' : 'second', style: etat.selection ? 'width:auto;margin:0' : null,
      onclick: () => { etat.selection = etat.selection ? null : new Set(); principal('stock'); } }, etat.selection ? '✓ Fini' : '☑︎ Plusieurs') : null);
  corps.append(outils, champ, puces, filtresZone, liste);
  if (etat.selection && affichageStock() === 'tableau') { corps.classList.add('avec-barre'); corps.append(barreLot()); }
  else etat.majBarreLot = null;
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
  { k: 'stock', titre: 'Stock', classe: 'nombre', val: (t, o) => t === 'bobines' ? celluleBobines(o) : (valeurCourte(t, o) || '—'), tri: quantiteTri },
  { k: 'etat', titre: 'État', val: (t, o) => pastille(statut(t, o)), tri: (t, o) => ORDRE_ETAT[statut(t, o)] ?? 9 },
  { k: 'seuil', titre: 'Seuil', val: (t, o) => seuilTexte(t, o), tri: (t, o) => num(o.seuil) },
  { k: 'fournisseur', titre: 'Fournisseur', val: (t, o) => o.fournisseur || '—', tri: (t, o) => o.fournisseur },
  { k: 'compte', titre: 'Compté le', val: (t, o) => o.compte ? jour(o.compte) : '—', tri: (t, o) => o.compte },
  { k: 'zone', titre: 'Emplacement', val: (t, o) => o.zone || '—', tri: (t, o) => o.zone },
  { k: 'famille', titre: 'Famille', val: (t, o) => o.famille || '—', tri: (t, o) => o.famille },
  // Bobines et descentes ont une case « couleur » ; pour un accessoire, la couleur est lue dans son nom (Sanji : « pourquoi
  // une colonne couleur alors qu'elle est dans le nom ? » : elle sert à trier et regrouper par couleur, pour tous les articles)
  { k: 'couleur', titre: 'Couleur', val: (t, o) => couleurDe(t, o) || '—', tri: (t, o) => couleurDe(t, o) },
  { k: 'groupe', titre: 'Dimension', val: (t, o) => dimensionDe(t, o) || '—', tri: (t, o) => dimensionDe(t, o) },
  { k: 'mode', titre: 'Façon de compter', val: (t, o) => t === 'accessoires' ? MODES[o.mode || 'quantite'] || o.mode : 'Mètres', tri: (t, o) => t === 'accessoires' ? (o.mode || 'quantite') : 'metres' },
  { k: 'unite', titre: 'Unité', val: (t, o) => t !== 'accessoires' ? 'ml' : o.mode === 'niveau' ? '—' : (o.unite || 'pièces'), tri: (t, o) => t !== 'accessoires' ? 'ml' : (o.unite || 'pièces') },
  { k: 'par_carton', titre: 'Contenance', val: (t, o) => num(o.par_carton) === null ? '—' : nombreJoli(num(o.par_carton)), tri: (t, o) => num(o.par_carton) },
  { k: 'note', titre: 'Note', classe: 'note', val: (t, o) => o.note || '—', tri: (t, o) => o.note },
  { k: 'maj', titre: 'Dernier changement', val: (t, o) => o.maj ? `${jour(o.maj)}${o.maj_par ? ' · ' + o.maj_par : ''}` : '—', tri: (t, o) => o.maj },
];
// Le stock et l'état juste après le nom : sur téléphone, c'est ce qu'on voit sans faire défiler de côté
const COLONNES_ORIGINE = ['stock', 'etat', 'ref', 'seuil', 'fournisseur', 'compte'];

/** Les couleurs connues (celles des descentes, et le réglage des accessoires gouttière), la plus longue d'abord. */
function couleursConnues() {
  const s = new Set(tous('descentes').map(o => o.couleur).filter(Boolean));
  const r = reglage('couleurs_accessoires_gouttiere');
  if (Array.isArray(r)) r.forEach(x => { if (x && x.libelle) s.add(x.libelle); });
  return [...s].sort((a, b) => b.length - a.length);
}
/** La couleur d'un article : sa case (remplie pour les accessoires aussi depuis le 12/11) ; à défaut, lue dans le nom. */
function couleurDe(t, o) {
  if (o.couleur || t !== 'accessoires') return o.couleur || null;
  const nom = String(o.nom || '');
  return couleursConnues().find(c => nom.endsWith(' ' + c) || nom.includes(' ' + c + ' ')) || null;
}
/** La dimension : largeur d'une bobine, diamètre d'une descente (« groupe ») ; pour un accessoire, sa case « dimension »
 *  (Ø80, G300, 33, 5x30, grandes… remplie depuis les noms le 12/11). */
function dimensionDe(t, o) { return (t === 'accessoires' ? o.dimension : o.groupe) || null; }
/** Les teintes d'une couleur, pour le filtre : « Anthracite 7016 / Noir 9005 » → Anthracite, Noir ; « Zink Tornado » → Tornado. */
function teintesDe(t, o) {
  const c = couleurDe(t, o);
  if (!c) return [];
  return c.split('/').map(x => x.replace(/\(?\bsolo\b\)?|,/gi, '').replace(/\bzink\b/gi, '').replace(/\d+/g, '').trim())
    .filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1));
}

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

/** ⚙ du tableau : le type d'affichage, et les colonnes (cocher ce qu'on veut voir, ranger en glissant ☰ ou avec ↑ ↓). */
function fenetreColonnes(apres) {
  let choix = colonnesChoisies().map(c => c.k);
  const liste = el('div');
  const typeAffichage = el('div', { class: 'puces' }, [['tableau', 'Tableau (façon Excel)'], ['dossiers', 'Dossiers']].map(([k, lib]) =>
    el('button', { class: affichageStock() === k ? 'actif' : '', onclick: () => { ecrireStockage('sd_affichage', k); fermerFenetre(); apres(); } }, lib)));
  function dessiner() {
    vider(liste);
    const ordre = [...choix, ...COLONNES_TOUTES.map(c => c.k).filter(k => !choix.includes(k))];
    ordre.forEach(k => {
      const c = COLONNES_TOUTES.find(x => x.k === k);
      const i = choix.indexOf(k), on = i >= 0;
      const ligne = ajouterA(el('div', { class: 'ligne-colonne' + (on ? '' : ' eteinte'), 'data-k': k }),
        on ? el('span', { class: 'poignee', title: 'Glisser pour ranger' }, '☰') : el('span', { class: 'poignee vide' }),
        el('label', { class: 'case etire' },
          el('input', { type: 'checkbox', checked: on, onchange: ev => { if (ev.target.checked) choix.push(k); else choix = choix.filter(x => x !== k); dessiner(); } }),
          c.titre),
        on ? el('button', { class: 'petit', disabled: i === 0, onclick: () => { [choix[i - 1], choix[i]] = [choix[i], choix[i - 1]]; dessiner(); } }, '↑') : null,
        on ? el('button', { class: 'petit', disabled: i === choix.length - 1, onclick: () => { [choix[i + 1], choix[i]] = [choix[i], choix[i + 1]]; dessiner(); } }, '↓') : null);
      if (on) glisserLigne(ligne, liste, () => {
        choix = [...liste.querySelectorAll('.ligne-colonne:not(.eteinte)')].map(x => x.dataset.k);
        dessiner();
      });
      liste.append(ligne);
    });
  }
  dessiner();
  const msg = el('p', { class: 'erreur' });
  ouvrirFenetre(el('div', {},
    el('h2', {}, '⚙︎ Affichage du stock'),
    el('div', { class: 'titre-section', style: 'margin-top:10px' }, 'Type d\'affichage'),
    typeAffichage,
    el('div', { class: 'titre-section' }, 'Colonnes du tableau'),
    el('p', { class: 'aide' }, '« Article » reste toujours la première colonne. Coche ce que tu veux voir ; range en glissant ☰ (ou avec ↑ ↓). Dans le tableau, tu peux aussi glisser le titre d\'une colonne pour la déplacer, et le toucher pour trier. C\'est retenu sur ton compte, sur tous tes appareils. Une colonne nouvelle (une information qui n\'existe pas encore) : demande-la dans ✎ Idées.'),
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
  const nCol = cols.length + 1;          // + Article (au début)
  const tr = triActuel();
  const fleche = k => tr && tr.k === k ? (tr.sens === 1 ? ' ▲' : ' ▼') : '';
  const corpsT = el('tbody');
  function rendre(b, niveau) {
    const cle = 'z:' + b.z.id;
    const ouvert = toutOuvrir() || etat.ouverts.has(cle);
    const nAlerte = b.articles.filter(x => enAlerte(statut(x.t, x.o))).length;
    const nb = b.articles.length;
    // « ☑ Plusieurs » : une coche par rayon / zone pour tout cocher (ou tout décocher) d'un coup
    let caseGroupe = null;
    if (etat.selection) {
      const cles = b.articles.map(x => x.t + '|' + x.o.id);
      const toutCoche = cles.length > 0 && cles.every(k => etat.selection.has(k));
      caseGroupe = el('input', { type: 'checkbox', class: 'coche-ligne', checked: toutCoche, title: 'Tout cocher dans ce rayon',
        onclick: ev => { ev.stopPropagation(); cles.forEach(k => toutCoche ? etat.selection.delete(k) : etat.selection.add(k)); redessiner(); if (etat.majBarreLot) etat.majBarreLot(); } });
    }
    corpsT.append(el('tr', { class: 'groupe', onclick: () => { if (ouvert) etat.ouverts.delete(cle); else etat.ouverts.add(cle); redessiner(); } },
      el('td', { colspan: nCol },
        el('span', { class: 'colle', style: `padding-left:${niveau * 18}px` }, caseGroupe, `${ouvert ? '▾' : '▸'} ${b.z.id} · ${b.z.libelle || ''}`,
          el('span', { class: 'compte' }, `${nb} article${nb > 1 ? 's' : ''}`),
          nAlerte ? el('span', { class: 'compte alerte' }, `· ${nAlerte} à signaler`) : null))));
    if (!ouvert) return;
    if (b.sous) b.sous.forEach(s => rendre(s, niveau + 1));
    else trier(b.articles).forEach(x => corpsT.append(...ligneTableau(x.t, x.o, cols)));
  }
  blocs.forEach(b => rendre(b, 0));
  // Le titre d'une colonne : le toucher trie ; le glisser déplace la colonne (Sanji : « changer l'ordre des colonnes par simple glisser-déposer »)
  const titre = (k, texte, classe) => {
    const th = el('th', { class: 'triable' + (classe ? ' ' + classe : ''), 'data-k': k === 'article' ? null : k,
      title: k === 'article' ? 'Trier' : 'Toucher : trier · glisser : déplacer la colonne',
      onclick: () => { if (th.dataset.glisse) { delete th.dataset.glisse; return; } changerTri(k, redessiner); } }, texte + fleche(k));
    if (k !== 'article') glisserColonne(th, k, cols, redessiner);
    return th;
  };
  return el('div', { class: 'tableau-cadre' },
    el('table', { class: 'tableau' },
      el('thead', {}, el('tr', {}, titre('article', 'Article', 'col1'), cols.map(c => titre(c.k, c.titre)))),
      corpsT));
}

/** Glisser le titre d'une colonne sur une autre pour la déplacer (souris et doigt) ; c'est retenu sur le compte. */
function glisserColonne(th, k, cols, redessiner) {
  th.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const x0 = ev.clientX;
    let glisse = false;
    const titres = () => [...th.parentElement.querySelectorAll('th[data-k]')];
    const dessous = e => titres().find(x => { const r = x.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
    const finir = () => {
      th.removeEventListener('pointermove', bouger); th.removeEventListener('pointerup', lacher); th.removeEventListener('pointercancel', finir);
      titres().forEach(x => x.classList.remove('cible', 'glisse'));
    };
    const bouger = e => {
      if (!glisse) { if (Math.abs(e.clientX - x0) < 10) return; glisse = true; th.classList.add('glisse'); }
      const c = dessous(e);
      titres().forEach(x => x.classList.toggle('cible', x === c && x !== th));
    };
    const lacher = async e => {
      finir();
      if (!glisse) return;               // un simple toucher : c'est le tri
      th.dataset.glisse = '1';           // le « clic » qui suit le lâcher ne trie pas
      const c = dessous(e);
      if (!c || c === th) return;
      const ordre = cols.map(x => x.k);
      const de = ordre.indexOf(k), vers = ordre.indexOf(c.dataset.k);
      if (de < 0 || vers < 0) return;
      ordre.splice(vers, 0, ordre.splice(de, 1)[0]);
      try { await enregistrerColonnes(ordre); } catch (err) { alert(err.message); }
      redessiner();
    };
    try { th.setPointerCapture(ev.pointerId); } catch (e) { /* rien */ }
    th.addEventListener('pointermove', bouger); th.addEventListener('pointerup', lacher); th.addEventListener('pointercancel', finir);
  });
}

/** Glisser une ligne par sa poignée ☰ pour la ranger dans une liste (souris et doigt) ; fin() quand on la lâche. */
function glisserLigne(ligne, liste, fin) {
  const poignee = ligne.querySelector('.poignee');
  poignee.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    try { poignee.setPointerCapture(ev.pointerId); } catch (e) { /* rien */ }
    ligne.classList.add('glisse');
    const bouger = e => {
      const autres = [...liste.querySelectorAll('.ligne-colonne:not(.eteinte)')].filter(x => x !== ligne);
      const avant = autres.find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (avant) { if (ligne.nextSibling !== avant) liste.insertBefore(ligne, avant); }
      else if (autres.length) autres[autres.length - 1].after(ligne);
    };
    const lacher = () => {
      poignee.removeEventListener('pointermove', bouger); poignee.removeEventListener('pointerup', lacher); poignee.removeEventListener('pointercancel', lacher);
      ligne.classList.remove('glisse');
      fin();
    };
    poignee.addEventListener('pointermove', bouger); poignee.addEventListener('pointerup', lacher); poignee.addEventListener('pointercancel', lacher);
  });
}

/**
 * Une ligne d'article. Sanji : « en Excel, modifiable directement dans la colonne sans passer par Modifier l'article » :
 * toucher une case modifiable l'ouvre sur place (Entrée ou toucher ailleurs : enregistré ; Échap : annulé).
 * Toucher le nom (ou une case qui ne se modifie pas) ouvre le détail, avec « Tout modifier / corbeille ».
 */
function ligneTableau(t, o, cols) {
  const s = statut(t, o);
  const contenu = el('div', { class: 'detail colle' });
  const detail = el('tr', { class: 'detail-ligne', hidden: true }, el('td', { colspan: cols.length + 1 }, contenu));
  const basculer = () => {
    detail.hidden = !detail.hidden;
    if (detail.hidden) return;
    remplirDetail(contenu, t, o);
    contenu.append(el('div', { class: 'rangee', style: 'margin-top:8px' },
      el('button', { class: 'petit', onclick: ev => { ev.stopPropagation(); editeurArticle(t, o); } }, '⚙︎ Tout modifier, ou corbeille…')));
  };
  // « ☑ Plusieurs » : on coche les lignes (toucher la ligne coche ou décoche), puis on change une colonne pour toutes
  const cleSel = t + '|' + o.id;
  const enSelection = !!etat.selection;
  const choisie = enSelection && etat.selection.has(cleSel);
  const coche = enSelection ? el('input', { type: 'checkbox', class: 'coche-ligne', checked: choisie,
    onclick: ev => ev.stopPropagation(),
    onchange: ev => {
      if (ev.target.checked) etat.selection.add(cleSel); else etat.selection.delete(cleSel);
      ligne.classList.toggle('choisie', ev.target.checked);
      if (etat.majBarreLot) etat.majBarreLot();
    } }) : null;
  const ligne = el('tr', { class: 'ligne-article' + (s === 'MANQUE' ? ' manque-ligne' : '') + (choisie ? ' choisie' : ''),
      onclick: () => { if (coche) coche.click(); else basculer(); } },
    // 🕐 au bout du nom (Sanji : « une 🕐 sur chaque item ») ; pas pendant « ☑ Plusieurs » (le nom coche la ligne)
    el('td', { class: 'col1', title: o.nom || o.ref }, el('div', { class: 'nom-case' }, coche, el('span', {}, o.nom_court || o.nom || o.ref),
      enSelection ? null : boutonHorloge(t, o))),
    // Sanji : « il faut pouvoir modifier les colonnes à la case » : même en « ☑ Plusieurs », toucher une case la modifie ;
    // c'est le nom (ou la coche) qui coche la ligne
    cols.map(c => {
      const modifiable = !!(EDITEURS[c.k] && EDITEURS[c.k](t, o));
      const td = el('td', { class: (c.classe || '') + (modifiable ? ' modifiable' : ''), title: modifiable ? 'Toucher pour modifier' : null }, c.val(t, o));
      if (modifiable) td.addEventListener('click', ev => { ev.stopPropagation(); editerCase(td, c, t, o); });
      return td;
    }));
  return [ligne, detail];
}

// ------------------------------------------------------------------ cases modifiables du tableau

function optionsZones(o) {
  const zs = tous('zones').filter(z => !z.est_groupe).sort((a, b) => triFr(String(a.id), String(b.id)));
  const l = zs.map(z => [z.id, `${z.id} · ${z.libelle || ''}`]);
  if (o.zone && !zs.some(z => z.id === o.zone)) l.push([o.zone, o.zone]);
  return [[null, '— choisir —'], ...l];
}
function optionsFamilles(o) {
  const fs = [...new Set(tous('accessoires').map(x => x.famille).filter(Boolean).concat(o.famille ? [o.famille] : []))].sort(triFr);
  return [...fs.map(f => [f, f]), [null, 'Aucune']];
}
function optionsFournisseurs(o) {
  let fours = tous('carnet').filter(c => c.type === 'fournisseur').map(c => String(c.libelle || '').trim()).filter(Boolean);
  if (!fours.length) fours = ARTICLES.flatMap(x => tous(x).map(a => a.fournisseur)).filter(Boolean);
  if (o.fournisseur) fours.push(o.fournisseur);
  return [...[...new Set(fours)].sort(triFr).map(f => [f, f]), [null, 'Aucun (N/A)']];
}
function optionsUnites(o) {
  const us = [['cartons', 'cartons'], ['rouleaux', 'rouleaux'], ['unités', 'unités']];
  tous('accessoires').map(x => x.unite).concat(o.unite ? [o.unite] : []).forEach(u => { if (u && !us.some(x => x[0] === u)) us.push([u, u]); });
  return [[null, 'pièces (rien d\'écrit)'], ...us];
}
function champListe(o, k, v) { const x = v || null; return pareil(o[k], x) ? null : { [k]: x }; }
function caseTexte(o, k) {
  return { type: 'texte', valeur: o[k] || '', lire: v => { const x = v.trim() || null; return pareil(o[k] || null, x) ? null : { [k]: x }; } };
}
function lireNombreCase(v, initial) {
  const t = v.trim();
  if (t === initial) return { inchange: true };
  if (!t) return { valeur: null };
  const d = Number(t.replace(',', '.'));
  if (isNaN(d) || d < 0) throw new Error('Il faut un nombre (0 ou plus).');
  return { valeur: d };
}
function caseNombre(o, k) {
  const initial = num(o[k]) === null ? '' : nombreJoli(num(o[k]));
  return { type: 'nombre', valeur: initial, lire: v => { const r = lireNombreCase(v, initial); return r.inchange ? null : { [k]: r.valeur }; } };
}
/** Un comptage fait depuis le site : signé comme dans l'appli (quand, par qui, depuis quel appareil). */
const comptage = champs => ({ ...champs, compte: new Date().toISOString(), compte_par: etat.identifiant, compte_appareil: APP.id });

const EDITEURS = {
  ref: (t, o) => ({ type: 'texte', valeur: o.ref || '', majuscules: true, lire: v => {
    const r = v.trim().toUpperCase().replace(/\s+/g, '-');
    if (r === String(o.ref || '').toUpperCase()) return null;
    if (!REF_VALIDE.test(r)) throw new Error('Référence invalide : lettres sans accent, chiffres et tirets (ex. FON-G300-BLA).');
    if (refPrise(r, t, o.id)) throw new Error(`La référence ${r} existe déjà (corbeille comprise).`);
    return { ref: r };
  }, apres: () => alert('La référence a changé : pense à réimprimer l\'étiquette.') }),
  stock: (t, o) => editeurStock(t, o),
  seuil: (t, o) => t === 'accessoires' && o.mode === 'niveau' ? null : caseNombre(o, 'seuil'),
  fournisseur: (t, o) => ({ type: 'liste', options: optionsFournisseurs(o), valeur: o.fournisseur, lire: v => champListe(o, 'fournisseur', v) }),
  zone: (t, o) => ({ type: 'liste', options: optionsZones(o), valeur: o.zone, lire: v => { if (!v) throw new Error('Choisis un emplacement.'); return champListe(o, 'zone', v); } }),
  famille: (t, o) => t !== 'accessoires' ? null : { type: 'liste', options: optionsFamilles(o), valeur: o.famille, lire: v => champListe(o, 'famille', v) },
  couleur: (t, o) => caseTexte(o, 'couleur'),
  groupe: (t, o) => {
    if (t === 'accessoires') return caseTexte(o, 'dimension');     // accessoires : une case libre (Ø80, G300, 5x30…)
    const gs = groupesDe(t);
    if (o.groupe && !gs.includes(o.groupe)) gs.push(o.groupe);
    return { type: 'liste', options: [...gs.map(g => [g, g]), [AUTRE, 'Autre…']], valeur: o.groupe, lire: v => {
      const g = v === AUTRE ? String(prompt(t === 'bobines' ? 'Autre largeur (ex. 330 mm)' : 'Autre diamètre (ex. Ø120)') || '').trim() : v;
      if (!g || g === o.groupe) return null;
      return { groupe: g, g_ordre: gOrdre(t, g), ordre: ordreSuivant(t, g) };
    } };
  },
  mode: (t, o) => t !== 'accessoires' ? null : { type: 'liste', options: Object.entries(MODES), valeur: o.mode || 'quantite', lire: v => v === (o.mode || 'quantite') ? null : { mode: v } },
  unite: (t, o) => t !== 'accessoires' || o.mode === 'niveau' ? null : { type: 'liste', options: optionsUnites(o), valeur: o.unite, lire: v => champListe(o, 'unite', v) },
  par_carton: (t, o) => (t === 'descentes' || (t === 'accessoires' && o.mode !== 'niveau')) ? caseNombre(o, 'par_carton') : null,
  note: (t, o) => caseTexte(o, 'note'),
};

/** La case Stock : un nombre ou un niveau se tape sur place ; bobines, descentes et « mixte » ouvrent une petite fenêtre. */
function editeurStock(t, o) {
  if (t === 'accessoires' && (o.mode || 'quantite') === 'quantite') {
    const initial = num(o.quantite) === null ? '' : nombreJoli(num(o.quantite));
    return { type: 'nombre', valeur: initial, lire: v => {
      const r = lireNombreCase(v, initial);
      if (r.inchange) return null;
      if (r.valeur === null) throw new Error('Indique combien il y en a.');
      return comptage({ quantite: r.valeur });
    } };
  }
  if (t === 'accessoires' && o.mode === 'niveau') {
    return { type: 'liste', options: [[null, '— niveau —'], ...niveaux()], valeur: o.niveau, lire: v => {
      if (!v) throw new Error('Choisis un niveau.');
      return v === o.niveau ? null : comptage({ niveau: v });
    } };
  }
  return { type: 'fenetre', ouvrir: () => fenetreCompter(t, o) };
}

/** Compter depuis le site : bobines (les longueurs), descentes (cartons et tuyaux), « mixte » (cartons fermés et niveau). */
function fenetreCompter(t, o) {
  const msg = el('p', { class: 'erreur' });
  const champTexte = (v, indice) => el('input', { type: 'text', inputmode: 'decimal', value: v, placeholder: indice });
  const nb = v => num(v) === null ? '' : nombreJoli(num(v));
  let lire;
  const corps = [];
  if (t === 'bobines') {
    const m = champTexte(metres(o).map(nombreJoli).join(' + '), 'ex. 80 + 42,5');
    corps.push(el('label', {}, 'Bobines au dépôt (mètres de chacune, séparés par +)'), m,
      el('p', { class: 'aide' }, 'Vide = plus aucune bobine. Les bobines sorties chez un ouvrier ne sont pas comptées ici.'));
    lire = () => {
      const l = m.value.split('+').map(x => x.trim()).filter(Boolean).map(x => Number(x.replace(',', '.')));
      if (l.some(x => isNaN(x) || x <= 0)) throw new Error('Écris les mètres de chaque bobine, séparés par + (ex. 80 + 42,5).');
      return { metres: l };
    };
  } else if (t === 'descentes') {
    const c = champTexte(nb(o.cartons), 'cartons'), tu = champTexte(nb(o.tuyaux), 'tuyaux en vrac');
    corps.push(el('label', {}, 'Cartons'), c, el('label', {}, 'Tuyaux (hors cartons)'), tu);
    lire = () => ({ cartons: lireNombreCase(c.value, '').valeur ?? 0, tuyaux: lireNombreCase(tu.value, '').valeur ?? 0 });
  } else {
    const c = champTexte(nb(o.quantite), 'cartons fermés');
    const n = choixListe([[null, '— niveau —'], ...niveaux()], o.niveau);
    corps.push(el('label', {}, 'Cartons fermés'), c, el('label', {}, 'Niveau du carton ouvert'), n);
    lire = () => {
      const q = lireNombreCase(c.value, '').valeur ?? null;
      if (q === null) throw new Error('Indique le nombre de cartons fermés.');
      if (!n.value) throw new Error('Choisis le niveau du carton ouvert.');
      return { quantite: q, niveau: n.value };
    };
  }
  ouvrirFenetre(el('div', {},
    el('h2', {}, `Compter : ${o.nom_court || o.nom || o.ref}`),
    corps, msg,
    el('button', { class: 'principal', onclick: async ev => {
      const b = ev.currentTarget;
      let champs;
      try { champs = lire(); } catch (e) { msg.textContent = e.message; return; }
      b.disabled = true;
      try { await ecrire(t, o.id, comptage(champs)); fermerFenetre(); (etat.redessinerStock || (() => principal(etat.onglet)))(); }
      catch (e) { msg.textContent = e.message; b.disabled = false; }
    } }, 'Enregistrer le comptage'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Annuler')),
    { fixe: true });
}

/**
 * « ☑ Plusieurs » (Sanji : « changer plusieurs cases d'une colonne en une fois ») : la barre du bas. On coche des lignes
 * (ou un rayon entier), on choisit la colonne et la valeur, « Appliquer » : une seule écriture pour tous. Les mêmes règles
 * que case par case (la référence et le stock ne se changent pas en lot). Un article que la colonne ne concerne pas est sauté.
 */
const COLONNES_LOT = ['fournisseur', 'zone', 'seuil', 'unite', 'mode', 'par_carton', 'famille', 'couleur', 'groupe', 'note'];
function barreLot() {
  const nb = el('strong');
  const selectionnes = () => [...etat.selection].map(k => { const i = k.indexOf('|'); const t = k.slice(0, i); return { t, o: trouver(t, k.slice(i + 1)) }; })
    .filter(x => x.o && !x.o.supprime);
  const choixCol = el('select', { class: 'dans-case' }, el('option', { value: '' }, '— quelle colonne ? —'),
    COLONNES_LOT.map(k => el('option', { value: k }, (COLONNES_TOUTES.find(c => c.k === k) || {}).titre || k)));
  const zoneValeur = el('span', { class: 'valeur-lot' });
  const msg = el('span', { class: 'erreur', style: 'margin:0' });
  let lireValeur = null;
  function majEditeur() {
    vider(zoneValeur); lireValeur = null; msg.textContent = '';
    const k = choixCol.value;
    if (!k) return;
    const exemple = selectionnes().map(x => EDITEURS[k](x.t, x.o)).find(e => e && e.type !== 'fenetre');
    if (!exemple) { zoneValeur.append(el('span', { class: 'aide' }, 'Cette colonne ne concerne pas les lignes cochées.')); return; }
    if (exemple.type === 'liste') {
      const s = choixListe(exemple.options.filter(([v]) => v !== AUTRE).concat(k === 'groupe' ? [[AUTRE, 'Autre…']] : []), null);
      s.classList.add('dans-case');
      zoneValeur.append(s);
      lireValeur = () => {
        if (s.value === AUTRE) { const v = String(prompt('Autre largeur ou diamètre (ex. 330 mm, Ø120)') || '').trim(); return v ? { brut: v, texte: v } : null; }
        return { brut: s.value, texte: s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : s.value };
      };
    } else {
      const i = el('input', { type: 'text', class: 'dans-case', inputmode: exemple.type === 'nombre' ? 'decimal' : null,
        placeholder: exemple.type === 'nombre' ? 'nombre (vide = effacer)' : 'texte (vide = effacer)' });
      zoneValeur.append(i);
      lireValeur = () => ({ brut: i.value, texte: i.value.trim() || '(vide)' });
    }
  }
  choixCol.addEventListener('change', majEditeur);
  const maj = () => { const n = etat.selection ? etat.selection.size : 0; nb.textContent = `${n} ligne${n > 1 ? 's' : ''} cochée${n > 1 ? 's' : ''}`; };
  etat.majBarreLot = maj;
  maj();
  return el('div', { class: 'barre-lot' },
    nb, choixCol, zoneValeur,
    el('button', { class: 'petit', style: 'background:var(--accent);color:var(--sur-accent);border-color:var(--accent)', onclick: async ev => {
      const b = ev.currentTarget;
      msg.textContent = '';
      const k = choixCol.value;
      if (!etat.selection.size) { msg.textContent = 'Coche d\'abord des lignes.'; return; }
      if (!k || !lireValeur) { msg.textContent = 'Choisis une colonne, puis la valeur.'; return; }
      const val = lireValeur();
      if (!val) return;
      const lot = [];
      let pasConcernes = 0, deja = 0;
      for (const x of selectionnes()) {
        const e = EDITEURS[k](x.t, x.o);
        if (!e || e.type === 'fenetre') { pasConcernes++; continue; }
        let champs;
        try { champs = e.lire(val.brut); } catch (err) { msg.textContent = `${x.o.nom_court || x.o.nom || x.o.ref} : ${err.message}`; return; }
        if (champs) lot.push({ table: x.t, id: x.o.id, champs }); else deja++;
      }
      const titre = (COLONNES_TOUTES.find(c => c.k === k) || {}).titre || k;
      if (!lot.length) { msg.textContent = `Rien à changer${deja ? ` (${deja} déjà à « ${val.texte} »)` : ''}${pasConcernes ? ` · ${pasConcernes} non concernés` : ''}.`; return; }
      if (!confirm(`« ${titre} » → « ${val.texte} » pour ${lot.length} article${lot.length > 1 ? 's' : ''} ?` +
        (deja ? `\n(${deja} l'ont déjà.)` : '') + (pasConcernes ? `\n(${pasConcernes} ne sont pas concernés par cette colonne.)` : ''))) return;
      b.disabled = true;
      try { await ecrireLot(lot); msg.textContent = ''; (etat.redessinerStock || (() => principal('stock')))(); alert(`C'est fait : ${lot.length} article${lot.length > 1 ? 's' : ''} changé${lot.length > 1 ? 's' : ''}.`); }
      catch (e) { msg.textContent = e.message; }
      b.disabled = false;
    } }, 'Appliquer'),
    el('button', { class: 'petit', onclick: () => { etat.selection.clear(); (etat.redessinerStock || (() => principal('stock')))(); maj(); } }, 'Tout décocher'),
    msg);
}

/** Ouvre une case sur place : Entrée ou toucher ailleurs = enregistré ; Échap = annulé. */
function editerCase(td, c, t, o0) {
  const o = trouver(t, o0.id) || o0;
  const e = EDITEURS[c.k] && EDITEURS[c.k](t, o);
  if (!e) return;
  if (e.type === 'fenetre') { e.ouvrir(); return; }
  if (td.querySelector('input, select')) return;
  const champ = e.type === 'liste' ? choixListe(e.options, e.valeur)
    : el('input', { type: 'text', value: e.valeur ?? '', inputmode: e.type === 'nombre' ? 'decimal' : null,
        autocapitalize: e.majuscules ? 'characters' : null, autocomplete: 'off', spellcheck: 'false' });
  champ.classList.add('dans-case');
  vider(td).append(champ);
  td.classList.add('en-cours');
  champ.focus();
  if (champ.select) champ.select();
  let fini = false;
  const redessiner = () => (etat.redessinerStock || (() => principal(etat.onglet)))();
  const valider = async () => {
    if (fini) return;
    fini = true;
    let champs;
    try { champs = e.lire(champ.value); } catch (err) { alert(err.message); redessiner(); return; }
    if (!champs) { redessiner(); return; }
    champ.disabled = true;
    try { await ecrire(t, o.id, champs); redessiner(); if (e.apres) e.apres(champs); }
    catch (err) { alert(err.message); redessiner(); }
  };
  champ.addEventListener('click', ev => ev.stopPropagation());
  champ.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); valider(); }
    else if (ev.key === 'Escape') { fini = true; redessiner(); }
  });
  champ.addEventListener('blur', () => valider());
  if (e.type === 'liste') champ.addEventListener('change', () => valider());
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

/** L'onglet Kits (Sanji, 11/11) : « choisir entre Kit vente et Kit déploiement, même lieu de départ, mais ce sont des sous-menus ». */
function pageKits(corps) {
  const sous = lireStockage('sd_sous_kits') === 'deploiement' ? 'deploiement' : 'vente';
  const nVente = tous('kits').filter(k => !k.pret).length;
  const nDep = tous('deploiements').filter(d => d.statut === 'parti').length;
  const nPrev = tous('deploiements').filter(d => d.statut === 'prevu').length;
  const infoDep = [nPrev ? `${nPrev} prévu${nPrev > 1 ? 's' : ''}` : null, nDep ? `${nDep} dehors` : null].filter(Boolean).join(' · ');
  const choisir = k => { ecrireStockage('sd_sous_kits', k); principal('kits'); };
  corps.append(el('div', { class: 'puces sous-menu' },
    el('button', { class: sous === 'vente' ? 'actif' : '', onclick: () => choisir('vente') }, `Kits vente${nVente ? ` (${nVente})` : ''}`),
    el('button', { class: sous === 'deploiement' ? 'actif' : '', onclick: () => choisir('deploiement') }, `Kits déploiement${infoDep ? ` (${infoDep})` : ''}`)));
  if (sous === 'deploiement') pageDeploiements(corps); else pageKitsVente(corps);
}

function pageKitsVente(corps) {
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

// ------------------------------------------------------------------ Kits déploiement (départs et retours par employé)

/**
 * Sanji, 11/11 : « quel employé est avec quoi : je sélectionne l'employé, j'ajoute les articles qu'il prend dans ce qui
 * est dispo (code-barres ou à la main, comme les kits), et quand je fais le retour je rentre ce qui rentre et ça se met
 * dans le stock auto » ; « plusieurs employés, ils fonctionnent en binôme » ; « nous au dépôt on utilise aussi les
 * feuilles de zinc : combien on en prend et pourquoi » ; « simple, rapide, efficace ».
 *  - le départ fait baisser le stock tout de suite (les bobines choisies passent « sorties » chez l'employé) ;
 *  - au retour, on note ce qui revient (bobines : les mètres qui restent), le stock remonte ; le reste est « utilisé » ;
 *  - « usage au dépôt » : rien ne revient, on note combien et pourquoi ;
 *  - un article jamais compté : le départ est noté, mais le stock (inconnu) n'est pas touché ;
 *  - même règles que l'appli (Deploiements.kt).
 */
const DEPOT = 'Dépôt';
function nomDep(d) {
  const qui = d.interne ? 'Usage au dépôt' : ((d.employes || []).join(' + ') || '?');
  return qui + (d.motif ? ` · ${d.motif}` : '');
}
function employesDuCarnet() { return [...new Set(tous('carnet').filter(c => c.type === 'employe').map(c => String(c.libelle || '').trim()).filter(Boolean))].sort(triFr); }
function nouvelIdDep() {
  const d = new Date(), p = x => String(x).padStart(2, '0');
  return `DEP-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${hex(2)}`;
}
const somme = l => l.reduce((a, x) => a + (Number(x) || 0), 0);
/** Ce qui est parti, en clair (pour un élément de « preleve »). */
function unitePrise(p, o) { return p.t === 'bobines' ? 'ml' : p.t === 'descentes' ? (p.champ || 'tuyaux') : uniteLigne(p.t, o, null); }
function prisN(p) { return p.t === 'bobines' ? somme(p.metres || []) : (num(p.voulu) ?? num(p.n) ?? 0); }
function revenuN(p, r) { if (!r) return 0; return p.t === 'bobines' ? somme(r.metres || []) : (num(r.n) ?? 0); }
function textePris(p, o) {
  if (p.t === 'bobines') { const m = p.metres || []; return `${m.length} bobine${m.length > 1 ? 's' : ''} (${m.map(x => nombreJoli(Number(x))).join(' + ') || '—'} ml)`; }
  return `${nombreJoli(prisN(p))} ${unitePrise(p, o)}` + (p.trace ? ' (niveau inchangé)' : p.inconnu ? ' (stock pas encore compté)' : '');
}

/** Aujourd'hui (AAAA-MM-JJ, heure locale) et une date courte « 12/11 ». */
function aujourdhui() { const d = new Date(), p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function jourDate(s) { if (!s) return '?'; const [, m, j] = String(s).slice(0, 10).split('-'); return `${j}/${m}`; }

function pageDeploiements(corps) {
  const deps = tous('deploiements');
  // Sanji : « avec date pour les kits déploiement, modifiable, si le patron crée le kit » : un départ peut être PRÉVU
  const prevus = deps.filter(d => d.statut === 'prevu').sort((a, b) => (a.pour_le || '').localeCompare(b.pour_le || ''));
  const partis = deps.filter(d => d.statut === 'parti').sort((a, b) => (a.depart_le || '').localeCompare(b.depart_le || ''));
  const rentres = deps.filter(d => d.statut === 'rentre').sort((a, b) => (b.retour_le || b.depart_le || '').localeCompare(a.retour_le || a.depart_le || ''));
  corps.append(el('div', { class: 'rangee', style: 'margin:0 0 6px' },
    el('button', { class: 'principal etire', style: 'margin:0', onclick: () => editeurDepart(null, {}) }, '+ Nouveau départ'),
    el('button', { class: 'second', onclick: () => editeurDepart(null, { interne: true }) }, '+ Usage au dépôt')));
  if (prevus.length) {
    corps.append(el('div', { class: 'titre-section' }, `Prévus (${prevus.length})`));
    prevus.forEach(d => corps.append(carteDep(d)));
  }
  corps.append(el('div', { class: 'titre-section' }, `Partis (${partis.length})`));
  if (!partis.length) corps.append(el('p', { class: 'aide' }, 'Personne n\'est dehors avec du matériel.'));
  partis.forEach(d => corps.append(carteDep(d)));
  const arch = el('details', { class: 'dossier', style: 'margin-top:16px' }, el('summary', {}, `Rentrés · archivés (${rentres.length})`));
  rentres.forEach(d => arch.append(el('div', { style: 'padding:0 10px 4px' }, carteDep(d))));
  corps.append(arch, blocParEmploye(deps));
}

function carteDep(d) {
  const prevu = d.statut === 'prevu';
  const n = (prevu ? d.lignes : d.preleve || []).length;
  const quand = prevu ? `prévu pour le ${jourDate(d.pour_le)}${d.cree_par ? ' (créé par ' + d.cree_par + ')' : ''}`
    : d.statut === 'parti' ? `parti le ${jourHeure(d.depart_le)}${d.depart_par ? ' (noté par ' + d.depart_par + ')' : ''}`
    : d.interne ? `le ${jourHeure(d.depart_le)}${d.depart_par ? ' (noté par ' + d.depart_par + ')' : ''}`
    : `rentré le ${jourHeure(d.retour_le)}${d.retour_par ? ' (noté par ' + d.retour_par + ')' : ''}`;
  // Sanji : « possibilité de cocher prêt comme pour les kits client » : vide = prévu, cochée = parti
  const coche = d.statut === 'rentre' ? el('div', { class: 'coche' }, '✓')
    : el('input', { type: 'checkbox', class: 'coche-dep', checked: d.statut === 'parti', title: prevu ? 'Cocher : ils partent' : 'Décocher : il repasse prévu',
        onclick: ev => { ev.stopPropagation(); ev.preventDefault(); basculerDep(d); } });
  return el('div', { class: 'carte kit', style: 'cursor:pointer', onclick: () => prevu ? editeurDepart(d, {}) : fenetreDep(d) },
    coche,
    el('div', { class: 'contenu' },
      el('div', { style: 'font-weight:700' }, nomDep(d)),
      el('div', { class: 'aide' }, `${n} article${n > 1 ? 's' : ''} · ${quand}`),
      d.note ? el('div', { style: 'color:var(--accent);font-size:14px' }, d.note) : null));
}

/**
 * La coche, comme les kits vente (Sanji : « si les patrons me les préremplissent, j'aurais juste à appliquer comme pour
 * un kit client ») : un prévu coché = ils partent (le stock baisse) ; un parti décoché = il repasse prévu (tout revient).
 */
async function basculerDep(d0) {
  const d = trouver('deploiements', d0.id) || d0;
  try {
    if (d.statut === 'prevu') {
      const lignes = d.lignes || [];
      if (!lignes.length) { alert('Ce départ est vide : ouvre-le pour ajouter des articles.'); return; }
      if (!(d.employes || []).length) { alert('Personne n\'est choisi : ouvre-le pour dire qui part.'); return; }
      const resume = lignes.map(l => { const o = trouver(l.t, l.id); return `• ${nombreJoli(num(l.n) ?? 1)} ${uniteLigne(l.t, o, l.u)} · ${o ? (o.nom_court || o.nom) : l.id}`; }).join('\n');
      if (!confirm(`« ${nomDep(d)} » est prêt ? Ils partent, le stock baisse de :\n${resume}`)) return;
      if (await partirPrevu(d)) principal('kits');
    } else if (d.statut === 'parti') {
      if (!confirm(`« ${nomDep(d)} » n'est plus parti ? Ce qu'il avait pris revient en stock, et il repasse en « prévu ».\n(Pour un vrai retour, avec ce qui a été utilisé : ouvre-le, puis « Retour ».)`)) return;
      const tout = (d.preleve || []).map(p => p.t === 'bobines' ? (p.metres || []).map(Number) : (num(p.voulu) ?? num(p.n) ?? 0));
      await appliquerRetour(d, tout, false, true);
      principal('kits');
    }
  } catch (e) { alert(e.message); }
}

/** Le départ d'un prévu tel qu'il a été préparé (les bobines choisies à l'avance, ou les suivantes si elles ne sont plus là). */
async function partirPrevu(d0) {
  await chargerTout();                            // le stock frais, juste avant d'y toucher
  const d = trouver('deploiements', d0.id) || d0;
  const lignes = d.lignes || [];
  const manques = calculerManques(lignes);
  if (manques.length && !confirm(`Il en manque :\n${manques.join('\n')}\n\nOn prend ce qu'il y a, et ces articles passent en « À signaler » rouge vif. Continuer ?`)) return false;
  const quand = new Date().toISOString();
  const { lot, preleve } = mouvementsDepart(d.id, (d.employes || []).join(' + '), d.motif || null, lignes, quand);
  lot.push({ table: 'deploiements', id: d.id, champs: { statut: 'parti', preleve, depart_le: quand, depart_par: etat.identifiant } });
  await ecrireLot(lot);
  return true;
}

/** Un déploiement : ce qui est parti (et revenu) ; s'il est dehors : Retour, Ils prennent encore, Supprimer (erreur). */
function fenetreDep(d0) {
  const d = trouver('deploiements', d0.id) || d0;
  const rentre = d.statut === 'rentre';
  const lignes = (d.preleve || []).map((p, i) => {
    const o = trouver(p.t, p.id);
    const r = (d.retour || [])[i];
    const u = unitePrise(p, o);
    const details = [`Pris : ${textePris(p, o)}`];
    if (rentre && !d.interne) {
      details.push(`revenu : ${nombreJoli(revenuN(p, r))} ${u}`, `utilisé : ${nombreJoli(Math.max(0, prisN(p) - revenuN(p, r)))} ${u}`);
    }
    return el('div', { class: 'ligne-panier' }, el('div', { class: 'etire' },
      el('div', { class: 'nom' }, o ? (o.nom_court || o.nom || o.ref) : p.id),
      el('div', { class: 'ref' }, details.join(' · '))));
  });
  ouvrirFenetre(el('div', {},
    el('h2', {}, nomDep(d)),
    el('p', { class: 'aide' }, [
      `Parti le ${jourHeure(d.depart_le)}${d.depart_par ? ' (noté par ' + d.depart_par + ')' : ''}`,
      rentre && !d.interne ? `rentré le ${jourHeure(d.retour_le)}${d.retour_par ? ' (noté par ' + d.retour_par + ')' : ''}` : null,
    ].filter(Boolean).join(' · ')),
    lignes.length ? lignes : el('p', { class: 'aide' }, 'Rien n\'est parti.'),
    rentre ? null : el('button', { class: 'principal', onclick: () => fenetreRetour(d) }, 'Retour : noter ce qui revient'),
    rentre ? null : el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => editeurDepart(d, { ajout: true }) }, '+ Ils prennent encore…'),
    rentre ? null : el('button', { class: 'second danger', style: 'width:100%;margin-top:8px', onclick: async ev => {
      if (!confirm('Supprimer ce départ (erreur de saisie) ? Tout ce qu\'il avait pris revient dans le stock.')) return;
      const b = ev.currentTarget; b.disabled = true;
      try {
        const tout = (d.preleve || []).map(p => p.t === 'bobines' ? (p.metres || []).map(Number) : (num(p.voulu) ?? num(p.n) ?? 0));
        await appliquerRetour(d, tout, true);
        fermerFenetre(); principal('kits');
      } catch (e) { alert(e.message); b.disabled = false; }
    } }, 'Supprimer (erreur) : tout revient'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Fermer')));
}

/** Ajouter au départ (recherche, scanner, douchette) : sans question de manque ici, on vérifie tout en validant. */
function ajouterAuDepart(b, t, o, redessiner) {
  if (t === 'bobines') { choisirBobines(b, o, b.lignes.find(x => x.t === t && x.id === o.id), redessiner); return; }
  const u = t === 'descentes' ? 'tuyaux' : undefined;
  const l = b.lignes.find(x => x.t === t && x.id === o.id && x.u === u);
  if (l) l.n = (num(l.n) ?? 1) + 1; else b.lignes.push({ t, id: o.id, n: 1, ...(u ? { u } : {}) });
  redessiner();
}

/**
 * Nouveau départ (qui, pour quoi, pour quand, quoi) : « Départ maintenant » (le stock baisse) ou « Enregistrer pour plus tard »
 * (prévu, le stock ne bouge pas : un patron peut le préparer) ; un départ prévu se rouvre ici (modifier, faire partir, supprimer).
 * options.interne : « usage au dépôt » ; options.ajout : « ils prennent encore » (dExistant est parti).
 */
function editeurDepart(dExistant, options) {
  const opt = options || {};
  const interne = !!opt.interne;
  const ajout = !!opt.ajout;
  const prevu = !!dExistant && !ajout && dExistant.statut === 'prevu';
  const d0 = prevu ? (trouver('deploiements', dExistant.id) || dExistant) : null;
  const brouillon = prevu
    ? { employes: [...(d0.employes || [])], motif: d0.motif || '', pourLe: d0.pour_le || aujourdhui(), lignes: (d0.lignes || []).map(l => ({ ...l })) }
    : { employes: interne ? [DEPOT] : [], motif: '', pourLe: aujourdhui(), lignes: [] };
  const zone = el('div');
  const msg = el('p', { class: 'erreur' });
  function dessiner() {
    vider(zone);
    let blocQui = null;
    if (!ajout && !interne) {
      const noms = [...new Set([...employesDuCarnet(), ...brouillon.employes])];
      blocQui = el('div', { class: 'puces', style: 'flex-wrap:wrap' },
        noms.map(nm => el('button', { class: brouillon.employes.includes(nm) ? 'actif' : '', onclick: () => {
          brouillon.employes = brouillon.employes.includes(nm) ? brouillon.employes.filter(x => x !== nm) : [...brouillon.employes, nm];
          dessiner();
        } }, nm)),
        el('button', { onclick: async () => {
          const nm = String(prompt('Prénom de l\'employé') || '').trim().slice(0, 40);
          if (!nm) return;
          if (!employesDuCarnet().some(x => x.toLowerCase() === nm.toLowerCase())) {
            try { await ecrire('carnet', 'E-' + hex(5), { type: 'employe', libelle: nm, supprime: false }); } catch (e) { alert(e.message); }
          }
          if (!brouillon.employes.includes(nm)) brouillon.employes.push(nm);
          dessiner();
        } }, '+ Autre…'));
    }
    const motif = el('input', { type: 'text', value: brouillon.motif, placeholder: interne ? 'ex. réparation, gabarit, essai…' : 'chantier, client… (facultatif)',
      oninput: e => { brouillon.motif = e.target.value; } });
    const panier = el('div');
    if (!brouillon.lignes.length) panier.append(el('p', { class: 'aide' }, 'Rien pour l\'instant : ajoute, scanne, ou passe à la douchette.'));
    brouillon.lignes.forEach((l, i) => {
      const o = trouver(l.t, l.id);
      const nVue = el('span', { class: 'n' }, nombreJoli(num(l.n) ?? 1));
      const bob = l.t === 'bobines' && Array.isArray(l.bobines) && l.bobines.length ? ` · bobines : ${l.bobines.map(x => nombreJoli(Number(x))).join(' + ')} ml` : '';
      const changer = delta => {
        if (l.t === 'bobines') { choisirBobines(brouillon, o, l, dessiner); return; }
        l.n = Math.max(1, (num(l.n) ?? 1) + delta); nVue.textContent = nombreJoli(l.n);
      };
      panier.append(el('div', { class: 'ligne-panier' },
        el('div', { class: 'etire' }, el('div', { class: 'nom' }, (o && (o.nom_court || o.nom)) || l.id),
          el('div', { class: 'ref' }, `${(o && o.ref) || ''} · en stock : ${(o && resume(l.t, o)) || 'pas compté'}${bob}`)),
        el('button', { class: 'petit', onclick: () => changer(-1) }, '−'), nVue, el('button', { class: 'petit', onclick: () => changer(1) }, '+'),
        l.t === 'descentes' ? el('button', { class: 'petit', onclick: () => { l.u = (l.u || 'tuyaux') === 'tuyaux' ? 'cartons' : 'tuyaux'; dessiner(); } }, l.u || 'tuyaux')
          : el('span', { class: 'aide' }, uniteLigne(l.t, o, l.u)),
        el('button', { class: 'petit danger', onclick: () => { brouillon.lignes.splice(i, 1); dessiner(); } }, '✕')));
    });
    const date = el('input', { type: 'date', value: brouillon.pourLe, oninput: e => { brouillon.pourLe = e.target.value; } });
    ajouterA(zone,
      el('h2', {}, ajout ? `${nomDep(dExistant)} : ils prennent encore` : interne ? 'Usage au dépôt' : prevu ? 'Départ prévu' : 'Nouveau départ'),
      prevu ? el('p', { class: 'aide' }, `Prévu${d0.cree_par ? ' par ' + d0.cree_par : ''} : le stock n'a pas encore bougé. Modifie-le, puis « Départ maintenant » quand ils partent.`) : null,
      interne ? el('p', { class: 'aide' }, 'Ce que le dépôt utilise lui-même (feuilles de zinc…) : rien ne revient ; on note combien et pourquoi.') : null,
      blocQui ? [el('label', {}, 'Qui part ? (un ou plusieurs)'), blocQui] : null,
      ajout ? null : [el('label', {}, interne ? 'Pourquoi ?' : 'Chantier / motif'), motif],
      ajout || interne ? null : [el('label', {}, 'Pour le'), date],
      el('label', {}, `Ce qui part (${brouillon.lignes.length})`), panier,
      el('div', { class: 'rangee', style: 'margin-top:10px' },
        el('button', { class: 'second etire', onclick: () => choisirArticle(brouillon, dessiner, ajouterAuDepart, 'Ajouter au départ') }, '+ Ajouter un article'),
        el('button', { class: 'second', onclick: () => scanner(code => {
          const x = trouverParCode(code);
          if (!x) { alert(`Code inconnu : ${code}`); return; }
          ajouterAuDepart(brouillon, x.t, x.o, dessiner);
        }) }, '▣ Scanner')),
      msg,
      el('button', { class: 'principal', onclick: ev => valider(ev.currentTarget, true) },
        ajout || interne ? 'Valider (le stock baisse)' : 'Départ maintenant (le stock baisse)'),
      ajout || interne ? null : el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: ev => valider(ev.currentTarget, false) },
        prevu ? 'Enregistrer les changements (toujours prévu)' : 'Enregistrer pour plus tard (prévu, le stock ne bouge pas)'),
      prevu ? el('button', { class: 'second danger', style: 'width:100%;margin-top:8px', onclick: async ev => {
        if (!confirm('Supprimer ce départ prévu ? (Rien n\'est encore parti : le stock ne bouge pas.)')) return;
        const b = ev.currentTarget; b.disabled = true;
        try { await ecrire('deploiements', d0.id, { supprime: true }); fermerFenetre(); principal('kits'); }
        catch (e) { msg.textContent = e.message; b.disabled = false; }
      } }, 'Supprimer ce départ prévu') : null,
      el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, prevu ? 'Fermer' : 'Annuler'));
  }
  async function valider(b, partir) {
    msg.textContent = '';
    if (!brouillon.lignes.length) { msg.textContent = 'Ajoute au moins un article.'; return; }
    if (!ajout && !interne && !brouillon.employes.length) { msg.textContent = 'Choisis qui part.'; return; }
    if (interne && !brouillon.motif.trim()) { msg.textContent = 'Écris pourquoi (ex. réparation…).'; return; }
    const lignesJson = brouillon.lignes.map(l => ({ t: l.t, id: l.id, n: num(l.n) ?? 1, ...(l.u ? { u: l.u } : {}),
      ...(Array.isArray(l.bobines) && l.bobines.length ? { bobines: l.bobines.map(Number) } : {}) }));
    b.disabled = true;
    if (!partir) {
      // Prévu : on enregistre seulement (le stock ne bouge pas)
      try {
        await ecrire('deploiements', prevu ? d0.id : nouvelIdDep(), {
          employes: brouillon.employes, interne: false, motif: brouillon.motif.trim().slice(0, 120) || null,
          lignes: lignesJson, pour_le: brouillon.pourLe || null,
          ...(prevu ? {} : { statut: 'prevu', preleve: [], cree_par: etat.identifiant, supprime: false }) });
        fermerFenetre(); ecrireStockage('sd_sous_kits', 'deploiement'); principal('kits');
      } catch (e) { msg.textContent = e.message; b.disabled = false; }
      return;
    }
    try {
      await chargerTout();                         // le stock frais, juste avant d'y toucher
      const manques = calculerManques(brouillon.lignes);
      if (manques.length && !confirm(`Il en manque :\n${manques.join('\n')}\n\nOn prend ce qu'il y a, et ces articles passent en « À signaler » rouge vif. Continuer ?`)) {
        b.disabled = false; return;
      }
      const dAvant = ajout || prevu ? (trouver('deploiements', dExistant.id) || dExistant) : null;
      const id = dAvant ? dAvant.id : nouvelIdDep();
      const employes = ajout ? (dAvant.employes || []) : brouillon.employes;
      const motifTexte = ajout ? (dAvant.motif || null) : (brouillon.motif.trim().slice(0, 120) || null);
      const quand = new Date().toISOString();
      const { lot, preleve } = mouvementsDepart(id, employes.join(' + '), motifTexte, lignesJson, quand);
      const champsDep = ajout
        ? { lignes: [...(dAvant.lignes || []), ...lignesJson], preleve: [...(dAvant.preleve || []), ...preleve] }
        : { employes, interne, motif: motifTexte, lignes: lignesJson, preleve, statut: interne ? 'rentre' : 'parti',
            depart_le: quand, depart_par: etat.identifiant, supprime: false,
            pour_le: interne ? aujourdhui() : (brouillon.pourLe || aujourdhui()),
            ...(dAvant ? {} : { cree_par: etat.identifiant }),
            ...(interne ? { retour: [], retour_le: quand, retour_par: etat.identifiant } : {}) };
      lot.push({ table: 'deploiements', id, champs: champsDep });
      await ecrireLot(lot);
      fermerFenetre();
      ecrireStockage('sd_sous_kits', 'deploiement');
      principal('kits');
    } catch (e) { msg.textContent = e.message; b.disabled = false; }
  }
  dessiner();
  ouvrirFenetre(zone, { fixe: true });
  etat.kitEnCours = { brouillon, dessiner, ajouteur: ajouterAuDepart };     // la douchette ajoute au départ
}

/** Ce qui manque (en stock) pour un départ ; un article jamais compté ne compte pas (on ne sait pas). */
function calculerManques(lignes) {
  return lignes.flatMap(l => {
    const o = trouver(l.t, l.id);
    if (!o) return [];
    const n = num(l.n) ?? 1;
    if (l.t === 'bobines') {
      const pris = Math.min(n, metres(o).length);
      return pris < n ? [`• ${o.nom_court || o.nom} : ${n} bobine(s), ${pris} au dépôt`] : [];
    }
    if (l.t === 'accessoires' && (o.mode || 'quantite') === 'niveau') return [];
    const avant = num(o[l.t === 'descentes' ? (l.u || 'tuyaux') : 'quantite']);
    if (avant === null) return [];
    return n > avant ? [`• ${o.nom_court || o.nom} : ${nombreJoli(n)} pris, ${nombreJoli(avant)} en stock`] : [];
  });
}

/** Les écritures d'un départ (une seule par article : le document ignore une 2e écriture au même instant), et ce qui est pris. */
function mouvementsDepart(depId, qui, motif, lignes, quand) {
  const parArticle = new Map();
  const preleve = [];
  for (const l of lignes) {
    const o = trouver(l.t, l.id);
    if (!o || o.supprime) continue;
    const cle = l.t + '|' + l.id;
    if (!parArticle.has(cle)) parArticle.set(cle, { t: l.t, id: o.id, champs: {}, metres: metres(o).slice(), sorties: sorties(o).slice() });
    const a = parArticle.get(cle);
    const n = num(l.n) ?? 1;
    const mvt = { type: 'depart', dep: depId, ouvrier: qui || null, quand, par: etat.identifiant, ...(motif ? { motif } : {}) };
    if (l.t === 'bobines') {
      // Les bobines choisies d'abord ; si l'une n'est plus au dépôt (départ prévu à l'avance), on prend la suivante
      const pris = [];
      (Array.isArray(l.bobines) ? l.bobines.map(Number) : []).forEach(m => {
        if (pris.length >= n) return;
        const i = a.metres.indexOf(m);
        if (i >= 0) { a.metres.splice(i, 1); pris.push(m); }
      });
      while (pris.length < n && a.metres.length) pris.push(a.metres.shift());
      pris.forEach(m => a.sorties.push({ m, ouvrier: qui || null, depuis: quand, par: etat.identifiant, dep: depId }));
      Object.assign(mvt, { n: pris.length, unite: 'bobine(s)', bobines: pris, m: somme(pris) });
      Object.assign(a.champs, { metres: a.metres, sorties: a.sorties, mouvement: mvt });
      if (pris.length < n) { mvt.manque = n - pris.length; a.champs.manque = { quand, par: etat.identifiant, dep: depId, n: n - pris.length }; }
      preleve.push({ t: l.t, id: o.id, metres: pris });
      continue;
    }
    Object.assign(mvt, { n, unite: uniteLigne(l.t, o, l.u) });
    if (l.t === 'accessoires' && (o.mode || 'quantite') === 'niveau') {
      a.champs.mouvement = { ...mvt, niveau_inchange: true };      // compté au niveau : noté, le niveau ne bouge pas
      preleve.push({ t: l.t, id: o.id, trace: true, n });
      continue;
    }
    const champ = l.t === 'descentes' ? (l.u || 'tuyaux') : 'quantite';
    const avant = champ in a.champs ? a.champs[champ] : num(o[champ]);
    if (avant === null) {                                         // jamais compté : noté, le stock (inconnu) ne bouge pas
      a.champs.mouvement = mvt;
      preleve.push({ t: l.t, id: o.id, champ, n: 0, voulu: n, inconnu: true });
      continue;
    }
    const retire = Math.min(n, avant);
    a.champs[champ] = avant - retire;
    a.champs.mouvement = mvt;
    if (n - retire > 0) { mvt.manque = n - retire; a.champs.manque = { quand, par: etat.identifiant, dep: depId, n: n - retire }; }
    preleve.push({ t: l.t, id: o.id, champ, n: retire, voulu: n });
  }
  return { lot: [...parArticle.values()].map(a => ({ table: a.t, id: a.id, champs: a.champs })), preleve };
}

/** Retour : pour chaque chose partie, combien revient (bobines : les mètres qui restent sur chacune). */
function fenetreRetour(d0) {
  const d = trouver('deploiements', d0.id) || d0;
  const champs = [];
  const msg = el('p', { class: 'erreur' });
  const blocs = (d.preleve || []).map((p, i) => {
    const o = trouver(p.t, p.id);
    const nom = o ? (o.nom_court || o.nom || o.ref) : p.id;
    if (p.t === 'bobines') {
      const inputs = (p.metres || []).map(m => el('input', { type: 'text', inputmode: 'decimal', placeholder: `vide ou 0 = finie`, 'data-max': m }));
      champs[i] = { bobines: true, inputs, max: (p.metres || []).map(Number) };
      return el('div', { class: 'carte' }, el('div', { class: 'nom', style: 'font-weight:700' }, nom),
        (p.metres || []).flatMap((m, j) => [el('label', {}, `Bobine de ${nombreJoli(Number(m))} ml : combien de mètres reviennent ?`), inputs[j]]));
    }
    const max = num(p.voulu) ?? num(p.n) ?? 0;
    const input = el('input', { type: 'text', inputmode: 'decimal', placeholder: `0 à ${nombreJoli(max)}` });
    champs[i] = { input, max };
    return el('div', { class: 'carte' }, el('div', { class: 'nom', style: 'font-weight:700' }, nom),
      el('label', {}, `Pris : ${textePris(p, o)} · combien reviennent ?`), input);
  });
  const lire = () => champs.map(c => {
    const un = (txt, max) => {
      const t = txt.trim();
      if (!t) return 0;
      const v = Number(t.replace(',', '.'));
      if (isNaN(v) || v < 0) throw new Error('Il faut des nombres (0 ou plus).');
      if (v > max) throw new Error(`Plus que ce qui est parti (${nombreJoli(max)}) : vérifie.`);
      return v;
    };
    return c.bobines ? c.inputs.map((x, j) => un(x.value, c.max[j])) : un(c.input.value, c.max);
  });
  ouvrirFenetre(el('div', {},
    el('h2', {}, `Retour : ${nomDep(d)}`),
    el('p', { class: 'aide' }, 'Écris ce qui revient au dépôt ; vide = rien ne revient (utilisé). Le stock remonte tout seul.'),
    el('button', { class: 'second', style: 'width:100%;margin-bottom:8px', onclick: () => {
      champs.forEach(c => { if (c.bobines) c.inputs.forEach((x, j) => { x.value = nombreJoli(c.max[j]); }); else c.input.value = nombreJoli(c.max); });
    } }, 'Tout revient (remplir)'),
    blocs, msg,
    el('button', { class: 'principal', onclick: async ev => {
      const b = ev.currentTarget;
      let valeurs;
      try { valeurs = lire(); } catch (e) { msg.textContent = e.message; return; }
      b.disabled = true;
      try { await appliquerRetour(d, valeurs, false); fermerFenetre(); principal('kits'); }
      catch (e) { msg.textContent = e.message; b.disabled = false; }
    } }, 'Valider le retour (le stock remonte)'),
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: () => fenetreDep(d) }, 'Retour au départ')),
    { fixe: true });
}

/**
 * Le retour : le stock remonte de ce qui revient ; le déploiement passe « rentré ». supprimer : erreur de saisie, tout revient
 * et il part à la corbeille ; remettrePrevu : décoché, tout revient et il repasse prévu.
 */
async function appliquerRetour(d0, valeurs, supprimer, remettrePrevu) {
  await chargerTout();
  const d = trouver('deploiements', d0.id) || d0;
  const qui = (d.employes || []).join(' + ') || null;
  const quand = new Date().toISOString();
  const parArticle = new Map();
  const retour = [];
  (d.preleve || []).forEach((p, i) => {
    const o = trouver(p.t, p.id);
    const v = valeurs[i];
    if (!o) { retour.push(null); return; }
    const cle = p.t + '|' + p.id;
    if (!parArticle.has(cle)) parArticle.set(cle, { t: p.t, id: o.id, champs: {}, metres: metres(o).slice(), sorties: sorties(o).slice() });
    const a = parArticle.get(cle);
    const mvt = { type: 'depart_retour', dep: d.id, ouvrier: qui, quand, par: etat.identifiant, ...(supprimer || remettrePrevu ? { annule: true } : {}) };
    if (p.t === 'bobines') {
      const restes = (Array.isArray(v) ? v : []).map(Number);
      (p.metres || []).forEach((m, j) => {
        // La bobine est encore notée « sortie » pour ce départ : on l'enlève ; sinon (déjà ramenée par le ±), on ne la compte pas deux fois
        const k = a.sorties.findIndex(s => s.dep === d.id && Number(s.m) === Number(m));
        if (k < 0) return;
        a.sorties.splice(k, 1);
        if ((restes[j] || 0) > 0) a.metres.push(restes[j]);
      });
      Object.assign(mvt, { n: restes.filter(x => x > 0).length, unite: 'bobine(s)', bobines: p.metres || [], restes, m: somme(p.metres || []), retour: somme(restes) });
      Object.assign(a.champs, { metres: a.metres, sorties: a.sorties, mouvement: mvt });
      retour.push({ t: p.t, id: p.id, metres: restes });
      return;
    }
    const n = Number(v) || 0;
    Object.assign(mvt, { n, unite: p.t === 'descentes' ? (p.champ || 'tuyaux') : uniteLigne(p.t, o, null) });
    if (p.trace || p.inconnu) {
      if (n > 0) a.champs.mouvement = { ...mvt, ...(p.trace ? { niveau_inchange: true } : {}) };
      retour.push({ t: p.t, id: p.id, trace: true, n });
      return;
    }
    if (n > 0) {
      const avant = p.champ in a.champs ? a.champs[p.champ] : (num(o[p.champ]) ?? 0);
      a.champs[p.champ] = avant + n;
      a.champs.mouvement = mvt;
    }
    retour.push({ t: p.t, id: p.id, champ: p.champ, n });
  });
  const lot = [...parArticle.values()].filter(a => Object.keys(a.champs).length).map(a => ({ table: a.t, id: a.id, champs: a.champs }));
  lot.push({ table: 'deploiements', id: d.id, champs: remettrePrevu
    ? { statut: 'prevu', preleve: [], retour: null, depart_le: null, depart_par: null }
    : { statut: 'rentre', retour, retour_le: quand, retour_par: etat.identifiant, ...(supprimer ? { supprime: true } : {}) } });
  await ecrireLot(lot);
}

/** « Par employé » : qui a pris quoi, ce qui est revenu, ce qui est utilisé, ce qui est encore dehors (binômes : sous chacun). */
function blocParEmploye(deps) {
  const det = el('details', { class: 'dossier', style: 'margin-top:12px' }, el('summary', {}, 'Par employé : qui a pris quoi'));
  const par = new Map();
  deps.filter(d => d.statut !== 'prevu').forEach(d => (d.employes || []).forEach(e => { if (!par.has(e)) par.set(e, []); par.get(e).push(d); }));
  if (!par.size) det.append(el('p', { class: 'aide', style: 'padding:0 14px 10px' }, 'Rien pour l\'instant.'));
  [...par.keys()].sort(triFr).forEach(e => {
    const l = par.get(e).sort((a, b) => (b.depart_le || '').localeCompare(a.depart_le || ''));
    const enCours = l.filter(d => d.statut === 'parti').length;
    const totaux = new Map();
    l.forEach(d => (d.preleve || []).forEach((p, i) => {
      const o = trouver(p.t, p.id);
      const u = unitePrise(p, o);
      const k = `${p.t}|${p.id}|${u}`;
      const x = totaux.get(k) || { nom: o ? (o.nom_court || o.nom || o.ref) : p.id, u, pris: 0, revenu: 0, dehors: 0 };
      const pr = prisN(p);
      x.pris += pr;
      if (d.statut === 'parti') x.dehors += pr; else x.revenu += revenuN(p, (d.retour || [])[i]);
      totaux.set(k, x);
    }));
    const lignes = [...totaux.values()].sort((a, b) => triFr(a.nom, b.nom));
    const tableau = el('table', { class: 'tableau' },
      el('thead', {}, el('tr', {}, ['Article', 'Pris', 'Revenu', 'Utilisé', 'Encore dehors'].map((c, i) => el('th', { class: i === 0 ? 'col1' : '' }, c)))),
      el('tbody', {}, lignes.map(x => el('tr', {},
        el('td', { class: 'col1' }, x.nom),
        el('td', {}, `${nombreJoli(x.pris)} ${x.u}`),
        el('td', {}, x.revenu ? `${nombreJoli(x.revenu)} ${x.u}` : '—'),
        el('td', { class: 'nombre' }, `${nombreJoli(Math.max(0, x.pris - x.revenu - x.dehors))} ${x.u}`),
        el('td', {}, x.dehors ? `${nombreJoli(x.dehors)} ${x.u}` : '—')))));
    det.append(el('details', { class: 'dossier', style: 'margin:0 10px 8px' },
      el('summary', {}, e, el('span', { class: 'compte' }, `${l.length} départ${l.length > 1 ? 's' : ''}${enCours ? ` · ${enCours} dehors` : ''}`)),
      el('div', { class: 'tableau-cadre', style: 'margin:0 10px 10px' }, tableau),
      el('div', { style: 'padding:0 10px 6px' }, l.map(d => carteDep(d)))));
  });
  return det;
}

function ouvrirFenetre(contenu, options) {
  // On remplace la fenêtre ouverte sans « fermer » le kit en cours (choix d'un article, scanner, questions…)
  if (etat.fenetre) { etat.fenetre.remove(); etat.fenetre = null; }
  // options.fixe : toucher à côté ne ferme pas (un formulaire en cours ne se perd pas par erreur) ; retenu sur le contenu,
  // pour quand on y revient (après le choix d'un article, d'une bobine…)
  if (options && options.fixe && contenu.dataset) contenu.dataset.fixe = '1';
  const fixe = !!(contenu.dataset && contenu.dataset.fixe === '1');
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
function choisirArticle(brouillon, retour, ajouteur, titre) {
  const zone = el('div');
  const champ = el('input', { type: 'search', placeholder: 'Réf ou nom (ex. coude 80 blanc)' });
  const res = el('div', { class: 'choix' });
  // ajouteur : ajouterAuKit (kit vente) ou ajouterAuDepart (kit déploiement)
  const ajouter = (t, o) => { ouvrirFenetre(zonePanier); (ajouteur || ajouterAuKit)(brouillon, t, o, retour); };
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
  zone.append(el('h2', {}, titre || 'Ajouter au kit'), champ, res,
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
    (kit.ajouteur || ajouterAuKit)(kit.brouillon, x.t, x.o, kit.dessiner);
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

// ------------------------------------------------------------------ Carnet (fournisseurs et employés)

/**
 * Le carnet, comme dans l'appli (Carnet.kt) : pour chacun un libellé (le nom de l'entreprise, le prénom) et une note libre.
 *  - renommer un fournisseur met ses articles à jour (s'il prend le nom d'un autre, les deux fusionnent) ;
 *  - renommer un employé met à jour les bobines qu'il a en main et ses kits déploiement ;
 *  - retirer un fournisseur : ses articles passent sans fournisseur (N/A).
 */
const TYPES_CARNET = [['fournisseur', 'Fournisseurs'], ['employe', 'Employés']];
const lignesCarnet = type => tous('carnet').filter(c => c.type === type).sort((a, b) => triFr(String(a.libelle || ''), String(b.libelle || '')));
const articlesDuFournisseur = nom => ARTICLES.flatMap(t => tous(t).filter(o => (o.fournisseur || '').trim() === nom).map(o => ({ t, o })));
const bobinesEnMain = nom => tous('bobines').reduce((n, o) => n + sorties(o).filter(s => String(s.ouvrier || '').split(' + ').includes(nom)).length, 0);
const departsDehors = nom => tous('deploiements').filter(d => d.statut === 'parti' && (d.employes || []).includes(nom)).length;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

function pageCarnet(corps) {
  const type = lireStockage('sd_carnet_type') === 'employe' ? 'employe' : 'fournisseur';
  corps.append(el('div', { class: 'puces sous-menu' }, TYPES_CARNET.map(([k, lib]) =>
    el('button', { class: k === type ? 'actif' : '', onclick: () => { ecrireStockage('sd_carnet_type', k); principal('carnet'); } }, lib))));
  corps.append(el('p', { class: 'aide' }, 'Touche une ligne pour la modifier, lui ajouter une note (un téléphone, par exemple) ou la retirer.'));
  const lignes = lignesCarnet(type);
  if (!lignes.length) corps.append(el('p', { class: 'aide' }, 'Rien pour l\'instant.'));
  lignes.forEach(r => {
    const nom = r.libelle || '?';
    let sous = null;
    if (type === 'fournisseur') { const n = articlesDuFournisseur(nom).length; sous = n ? pluriel(n, 'article') : 'aucun article'; }
    else {
      const b = bobinesEnMain(nom), d = departsDehors(nom);
      sous = [b ? `${pluriel(b, 'bobine')} en main` : null, d ? `${pluriel(d, 'départ')} en cours` : null].filter(Boolean).join(' · ') || null;
    }
    corps.append(el('div', { class: 'carte', style: 'cursor:pointer;padding:10px 14px', onclick: () => fenetreCarnet(type, r) },
      el('div', { style: 'font-weight:700' }, nom),
      sous ? el('div', { class: 'aide' }, sous) : null,
      r.note ? el('div', { style: 'color:var(--accent);font-size:14px;white-space:pre-wrap' }, r.note) : null));
  });
  if (type === 'fournisseur') {
    // Les noms utilisés par des articles mais absents du carnet
    const noms = lignes.map(r => String(r.libelle || '').toLowerCase());
    const absents = new Map();
    ARTICLES.forEach(t => tous(t).forEach(o => { const f = (o.fournisseur || '').trim(); if (f && !noms.includes(f.toLowerCase())) absents.set(f, (absents.get(f) || 0) + 1); }));
    absents.forEach((n, f) => corps.append(el('div', { class: 'rangee', style: 'margin:8px 0' },
      el('span', { class: 'etire', style: 'color:var(--orange)' }, `« ${f} » : ${pluriel(n, 'article')}, pas dans le carnet`),
      el('button', { class: 'petit', onclick: async () => { try { await ecrire('carnet', 'F-' + hex(6), { type: 'fournisseur', libelle: f, note: null, supprime: false }); principal('carnet'); } catch (e) { alert(e.message); } } }, `Ajouter « ${f} »`))));
    const sans = ARTICLES.reduce((n, t) => n + tous(t).filter(o => !(o.fournisseur || '').trim()).length, 0);
    if (sans) corps.append(el('p', { class: 'aide' }, `${pluriel(sans, 'article')} sans fournisseur (N/A).`));
  }
  corps.append(el('button', { class: 'principal', onclick: () => fenetreCarnet(type, null) }, type === 'fournisseur' ? '+ Ajouter un fournisseur' : '+ Ajouter un employé'));
}

/** Créer (r null) ou modifier une ligne du carnet : libellé, note ; « Retirer ». */
function fenetreCarnet(type, r0) {
  const r = r0 ? (trouver('carnet', r0.id) || r0) : null;
  const ancien = r ? (r.libelle || '') : '';
  const nom = el('input', { type: 'text', value: ancien, placeholder: type === 'fournisseur' ? 'Nom de l\'entreprise' : 'Prénom', autocapitalize: 'words' });
  // Sanji : pour les employés, « ne marque pas téléphone etc., juste note »
  const note = el('textarea', { placeholder: type === 'employe' ? 'Note' : 'Note (téléphone, contact…)' }, r ? (r.note || '') : '');
  const msg = el('p', { class: 'erreur' });
  const enregistrer = async b => {
    msg.textContent = '';
    const libelle = nom.value.trim().slice(0, 60);
    const texteNote = note.value.trim().slice(0, 500) || null;
    if (!libelle) { msg.textContent = 'Il faut un nom.'; return; }
    const doublon = lignesCarnet(type).find(x => String(x.libelle || '').toLowerCase() === libelle.toLowerCase() && (!r || x.id !== r.id));
    b.disabled = true;
    try {
      if (!r) {
        if (doublon) { msg.textContent = `« ${doublon.libelle} » est déjà dans le carnet.`; b.disabled = false; return; }
        await ecrire('carnet', (type === 'fournisseur' ? 'F-' : 'E-') + hex(6), { type, libelle, note: texteNote, supprime: false });
        fermerFenetre(); principal('carnet'); return;
      }
      const lot = [];
      const champs = {};
      if ((r.note || null) !== texteNote) champs.note = texteNote;
      let info = null;
      if (libelle !== ancien) {
        if (type === 'fournisseur') {
          // Nom déjà pris : les deux fiches fusionnent (celle-ci part à la corbeille, ses articles passent à l'autre)
          const cible = doublon ? doublon.libelle : libelle;
          if (doublon) champs.supprime = true; else champs.libelle = libelle;
          const arts = articlesDuFournisseur(ancien);
          arts.forEach(x => lot.push({ table: x.t, id: x.o.id, champs: { fournisseur: cible } }));
          info = doublon ? `« ${ancien} » fusionné avec « ${cible} » (${pluriel(arts.length, 'article')}).` : `Renommé en « ${cible} » (${pluriel(arts.length, 'article')} mis à jour).`;
        } else {
          if (doublon) { msg.textContent = `« ${doublon.libelle} » est déjà dans le carnet.`; b.disabled = false; return; }
          champs.libelle = libelle;
          // Ses bobines en main et ses kits déploiement prennent le nouveau prénom
          // (un binôme est noté « Paul + Jean » : on remplace le prénom dedans)
          const dansQui = q => String(q || '').split(' + ').includes(ancien);
          const remplacer = q => String(q).split(' + ').map(e => e === ancien ? libelle : e).join(' + ');
          tous('bobines').filter(o => sorties(o).some(s => dansQui(s.ouvrier))).forEach(o =>
            lot.push({ table: 'bobines', id: o.id, champs: { sorties: sorties(o).map(s => dansQui(s.ouvrier) ? { ...s, ouvrier: remplacer(s.ouvrier) } : s) } }));
          tous('deploiements').filter(d => (d.employes || []).includes(ancien)).forEach(d =>
            lot.push({ table: 'deploiements', id: d.id, champs: { employes: d.employes.map(e => e === ancien ? libelle : e) } }));
          info = `Renommé en « ${libelle} ».`;
        }
      }
      if (Object.keys(champs).length) lot.push({ table: 'carnet', id: r.id, champs });
      if (lot.length) await ecrireLot(lot);
      fermerFenetre(); principal('carnet');
      if (info) alert(info);
    } catch (e) { msg.textContent = e.message; b.disabled = false; }
  };
  const retirer = async b => {
    const n = type === 'fournisseur' ? articlesDuFournisseur(ancien).length : bobinesEnMain(ancien);
    const message = type === 'fournisseur' ? (n ? `Ses ${pluriel(n, 'article')} passeront sans fournisseur (N/A).` : 'Il n\'a aucun article.')
      : (n ? `Il a encore ${pluriel(n, 'bobine')} en main : elles restent à son nom jusqu'au retour.` : 'L\'historique garde son nom.');
    if (!confirm(`Retirer « ${ancien} » ?\n\n${message}`)) return;
    b.disabled = true;
    try {
      const lot = [{ table: 'carnet', id: r.id, champs: { supprime: true } }];
      if (type === 'fournisseur') articlesDuFournisseur(ancien).forEach(x => lot.push({ table: x.t, id: x.o.id, champs: { fournisseur: null } }));
      await ecrireLot(lot);
      fermerFenetre(); principal('carnet');
    } catch (e) { msg.textContent = e.message; b.disabled = false; }
  };
  ouvrirFenetre(el('div', {},
    el('h2', {}, r ? ancien : (type === 'fournisseur' ? 'Nouveau fournisseur' : 'Nouvel employé')),
    el('label', {}, type === 'fournisseur' ? 'Nom de l\'entreprise' : 'Prénom'), nom,
    el('label', {}, 'Note'), note,
    r && type === 'fournisseur' ? el('p', { class: 'aide' }, 'Renommer un fournisseur met aussi ses articles à jour.') : null,
    r && type === 'employe' ? el('p', { class: 'aide' }, 'Renommer un employé met aussi à jour les bobines qu\'il a en main et ses kits déploiement.') : null,
    msg,
    el('button', { class: 'principal', onclick: ev => enregistrer(ev.currentTarget) }, 'Enregistrer'),
    r ? el('button', { class: 'second danger', style: 'width:100%;margin-top:8px', onclick: ev => retirer(ev.currentTarget) }, 'Retirer') : null,
    el('button', { class: 'second', style: 'width:100%;margin-top:8px', onclick: fermerFenetre }, 'Annuler')),
    { fixe: true });
  nom.focus();
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
    el('div', { class: 'titre-section' }, 'Mon compte'),
    el('p', {}, el('strong', {}, etat.identifiant || '?'), etat.admin ? ' · admin' : ' · magasinier'),
    el('button', { class: 'second', style: 'width:100%;margin-top:4px', onclick: () => ecranChangement(false) }, 'Changer mon mot de passe ou mon identifiant'),
    el('div', { class: 'titre-section' }, 'Comptes (site et appli)'));
  // Sanji, 11/11 : les comptes et la coche admin sont réservés aux admins (« un admin minimum est obligatoire »)
  const liste = el('div', {}, el('p', { class: 'aide' }, etat.admin ? 'Chargement…' : 'Réservé aux admins : demande à Yannick.'));
  ajouterA(corps,
    etat.admin ? el('p', { class: 'aide' }, 'Pour un oubli : donne un mot de passe provisoire (à dire à l\'oral) ; la personne choisira le sien en se connectant. Personne ne peut lire un mot de passe. Un admin peut aussi changer le code magasinier et retirer un appareil (dans l\'appli).') : null,
    liste,
    etat.admin ? el('button', { class: 'principal', onclick: () => fenetreCompte(null) }, '+ Nouveau compte') : null,
    blocAppareils(),
    // Sanji, 11/11 : « Sortir » devient « Déconnexion », en bas de Comptes
    el('button', { class: 'second danger', style: 'width:100%;margin-top:24px', onclick: () => {
      if (confirm('Te déconnecter de cet appareil ? Il faudra retaper ton identifiant et ton mot de passe.')) seDeconnecter();
    } }, 'Déconnexion'));
  if (!etat.admin) return;
  try {
    const r = await rpc('liste_comptes', moi());
    vider(liste);
    if (!r.ok) { liste.append(el('p', { class: 'erreur' }, r.message)); return; }
    (r.comptes || []).forEach(c => liste.append(el('div', { class: 'carte' },
      el('div', { style: 'font-weight:700' }, c.identifiant + (c.admin ? ' · admin' : '') + (c.moi ? ' (moi)' : '')),
      el('div', { class: 'aide' }, [c.a_changer ? 'doit encore choisir son mot de passe' : 'mot de passe choisi', c.appareils ? `connecté sur ${c.appareils} appareil(s)` : null, c.cree_par ? `créé par ${c.cree_par}` : null].filter(Boolean).join(' · ')),
      el('div', { class: 'rangee', style: 'margin-top:8px' },
        c.moi ? null : el('button', { class: 'petit', onclick: () => fenetreCompte(c) }, 'Mot de passe provisoire'),
        // La coche admin : un admin la donne ou la retire ; le document refuse de retirer le dernier admin
        el('label', { class: 'case', style: 'margin:0' },
          el('input', { type: 'checkbox', checked: !!c.admin, onchange: async ev => {
            const voulu = ev.target.checked;
            if (!confirm(voulu ? `« ${c.identifiant} » devient admin ? (code magasinier, comptes, retirer un appareil)` : `« ${c.identifiant} » n'est plus admin ?`)) { ev.target.checked = !voulu; return; }
            try { const x = await rpc('definir_admin', { ...moi(), p_compte: c.id, p_admin: voulu }); alert(x.message); }
            catch (e) { alert(e.message); }
            if (c.moi && !voulu) await demarrer(); else principal('comptes');
          } }), 'Admin'),
        c.moi ? null : el('button', { class: 'petit danger', onclick: async () => {
          if (!confirm(`Retirer le compte « ${c.identifiant} » ? Il ne pourra plus se connecter.`)) return;
          const x = await rpc('desactiver_compte', { ...moi(), p_compte: c.id }); alert(x.message); principal('comptes');
        } }, 'Retirer')))));
  } catch (e) { vider(liste).append(el('p', { class: 'erreur' }, e.message)); }
}

/**
 * Sanji, 11/11 : « un déployable pour les appareils autorisés (renommer appareil) : rien que moi j'en ai 5 ».
 * La liste des appareils autorisés (le téléphone de l'appli, chaque navigateur connecté au site) ; on peut leur donner un nom.
 * Sanji, 12/11 : « je pensais plutôt à un dépliant par utilisateur » : un dossier par compte (ses téléphones et navigateurs
 * dedans), « Sans compte » en dernier (un téléphone de l'appli en lecture seule).
 * Autoriser ou retirer un appareil reste dans l'appli (admin).
 */
function blocAppareils() {
  const zone = el('div', { style: 'padding:0 0 4px' }, el('p', { class: 'aide', style: 'padding:0 12px' }, 'Chargement…'));
  let charge = false;
  const ouverts = new Set();
  async function charger() {
    try {
      const r = await rpc('liste_appareils', moi());
      vider(zone);
      if (!r.ok) { zone.append(el('p', { class: 'erreur', style: 'padding:0 12px' }, r.message)); return; }
      const l = r.appareils || [];
      det.querySelector('summary').textContent = `Appareils autorisés (${l.length})`;
      // Un dossier par utilisateur (dans l'ordre alphabétique, « Sans compte » à la fin) ; dedans, l'ordre du document
      // (cet appareil d'abord, puis le plus récemment vu)
      const groupes = new Map();
      l.forEach(a => { const k = a.compte || ''; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(a); });
      const cles = [...groupes.keys()].sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, 'fr'));
      cles.forEach(k => {
        const liste = groupes.get(k);
        const retire = k && liste.some(a => !a.compte_actif);
        const corps = el('div', { style: 'padding:0 12px 6px' });
        // (un dossier ouvert le reste quand la liste se recharge, après un « Renommer »)
        const d = el('details', { class: 'dossier', ontoggle: () => { if (d.open) ouverts.add(k); else ouverts.delete(k); } },
          el('summary', {}, k || 'Sans compte (lecture seule)', retire ? el('span', { class: 'aide', style: 'font-weight:400' }, ' (compte retiré)') : null,
            liste.some(a => a.moi) ? el('span', { class: 'pastille p-OK' }, 'toi ici') : null,
            el('span', { class: 'compte' }, `${liste.length} appareil${liste.length > 1 ? 's' : ''}`)),
          corps);
        d.open = ouverts.has(k);
        zone.append(d);
        liste.forEach(a => ligneAppareil(corps, a));
      });
      zone.append(el('p', { class: 'aide', style: 'margin:8px 12px 6px' }, 'Pour retirer un appareil (perdu, changé…) : dans l\'appli, par un admin, avec le code magasinier.'));
    } catch (e) { vider(zone).append(el('p', { class: 'erreur', style: 'padding:0 12px' }, e.message)); }
  }
  function ligneAppareil(corps, a) {
    const nom = a.libelle || a.modele || a.id;
    const quoi = [a.navigateur ? 'site' : 'appli',
      a.libelle && a.modele ? a.modele : null,
      a.derniere_synchro ? `vu le ${jourHeure(a.derniere_synchro)}` : null].filter(Boolean).join(' · ');
    corps.append(el('div', { class: 'rangee', style: 'padding:8px 0;border-bottom:1px solid var(--ligne)' },
      el('div', { class: 'etire' },
        el('div', { style: 'font-weight:700' }, nom, a.moi ? el('span', { class: 'pastille p-OK', style: 'margin-left:8px' }, 'cet appareil') : null),
        el('div', { class: 'aide' }, quoi),
        el('div', { class: 'aide', style: 'font-family:ui-monospace,Menlo,Consolas,monospace' }, a.id)),
      el('button', { class: 'petit', onclick: async () => {
        const v = prompt('Nom de cet appareil (ex. PC du bureau, Firefox) — vide pour effacer :', a.libelle || '');
        if (v === null) return;
        try { const x = await rpc('renommer_appareil', { ...moi(), p_cible: a.id, p_libelle: v }); if (!x.ok) alert(x.message); await charger(); }
        catch (e) { alert(e.message); }
      } }, 'Renommer')));
  }
  const det = el('details', { class: 'dossier', style: 'margin-top:16px', ontoggle: () => { if (det.open && !charge) { charge = true; charger(); } } },
    el('summary', {}, 'Appareils autorisés'), zone);
  return det;
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
