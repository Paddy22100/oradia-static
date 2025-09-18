// pages/api/analyse-traversee.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
// CORS — dynamique et robuste
const ORIGINS = new Set([
  "https://oradia.fr",
  "https://www.oradia.fr",
  "http://localhost:3000",
  "http://localhost:5173",
  "null" // autorise les tests en ouvrant index.html en local (file://) — à retirer ensuite si tu veux
]);

const origin = req.headers.origin || "";
if (ORIGINS.has(origin)) {
  res.setHeader("Access-Control-Allow-Origin", origin);
} else {
  // par défaut on autorise le domaine prod
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
}
res.setHeader("Vary", "Origin");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

// Réfléchit dynamiquement les headers que le navigateur annonce en préflight
const reqHeaders = req.headers["access-control-request-headers"];
res.setHeader("Access-Control-Allow-Headers", reqHeaders ? reqHeaders : "Content-Type");

// Cache le résultat du préflight pour 24h
res.setHeader("Access-Control-Max-Age", "86400");

// Préflight
if (req.method === "OPTIONS") return res.status(204).end();

// (facultatif, mais utile)
res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};
    const b = body.boussole || {};

    // Helpers
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const sym = s => {
      if (!s || typeof s !== "string") return "—";
      const normalized = s.normalize("NFKD");
      if (normalized.includes("⚫") || /\u26AB/.test(normalized)) return "⚫"; // cercle noir
      if (normalized.includes("🔺") || /\u25B2/.test(normalized) || /\u1F53A/.test(normalized)) return "🔺"; // triangle
      return "—";
    };
    const pick = o => ({ carte: safe(o?.carte), polarite: sym(o?.polarite) });

    // Boussole
    const nord  = pick(b.nord);
    const sud   = pick(b.sud);
    const est   = pick(b.est);
    const ouest = pick(b.ouest);

    if (!nord.carte || !sud.carte || !est.carte || !ouest.carte) {
      return res.status(400).json({ error: "Boussole incomplète" });
    }

    // Pièces
    const piece = {
      emotions:     sym(body?.mutations?.emotionsPiece),
      besoins:      sym(body?.mutations?.besoinsPiece),
      revelations:  sym(body?.mutations?.revelationsPiece),
      actions:      sym(body?.mutations?.actionsPiece),
    };

    const isPass = (polCarte, polPiece) =>
      (polCarte !== "—" && polPiece !== "—" && polCarte !== polPiece);

    const pass = {
      emotions:     isPass(nord.polarite,  piece.emotions),
      besoins:      isPass(sud.polarite,   piece.besoins),
      revelations:  isPass(est.polarite,   piece.revelations),
      actions:      isPass(ouest.polarite, piece.actions),
    };

    const memoireCosmos = safe(body?.memoireCosmos);

    const SYSTEM = `
Tu es l’analyste officiel d’Oradia pour le Tirage de la Traversée.

Règles STRICTES :
- Chaque ligne doit suivre exactement ce format :
  Ligne X – NOMFAMILLE : NomCarte (Symbole = énergie féminine/masculine){— carte passerelle : … si passerelle=true}
- Utilise uniquement le symbole fourni (⚫ ou 🔺). Si '—', n’affiche aucun symbole.
- Ne jamais déplacer le symbole ni écrire avant le nom de la carte.
- La carte Mémoires Cosmos s’affiche sans symbole.
- Ajoute ensuite la synthèse du tirage.
- "Carte passerelle" UNIQUEMENT si passerelle=true.
- Mémoires Cosmos : pas de polarité.
- Style Oradia : poétique, clair, ancré.

Affichage final :
Votre Tirage de la traversée:
Ligne 1 – ÉMOTIONS : {NomCarte} ({Symbole} = énergie féminine/masculine) {— carte passerelle : … si passerelle=true}
Ligne 2 – BESOINS   : …
Ligne 3 – RÉVÉLATIONS : …
Ligne 4 – ACTIONS   : …
Carte Mémoires Cosmos :
{…}
Synthèse du tirage :
{…}
`.trim();

    const USER = `
Intention: ${safe(body.intention)}

Entrées + passerelles:
- L1 ÉMOTIONS     : ${nord.carte} (${nord.polarite}), piece=${piece.emotions}, passerelle=${pass.emotions}
- L2 BESOINS      : ${sud.carte} (${sud.polarite}), piece=${piece.besoins}, passerelle=${pass.besoins}
- L3 RÉVÉLATIONS  : ${est.carte} (${est.polarite}), piece=${piece.revelations}, passerelle=${pass.revelations}
- L4 ACTIONS      : ${ouest.carte} (${ouest.polarite}), piece=${piece.actions}, passerelle=${pass.actions}
- Carte MÉMOIRES COSMOS: ${memoireCosmos}
`.trim();

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 900,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER }
        ]
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));

    if (!r.ok) {
      const err = await r.text();
      console.error("[OpenAI ERROR][traversee]", err);
      return res.status(502).json({ error: "Analyse indisponible. Réessaie dans un instant." });
    }

    const data = await r.json();
    const texte = (data.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur [traversee]:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
