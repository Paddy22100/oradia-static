// pages/api/analyse-tore.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  // Clé API côté serveur
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};

    // Helpers
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const sym  = s => s === "🔺" ? "🔺" : (s === "⚫" ? "⚫" : "—");
    const norm = o => ({ carte: safe(o?.carte), polarite: sym(o?.polarite), piece: sym(o?.piece) });

    // Familles du Tore
    const fam = body.familles || {};
    const emotions       = norm(fam.emotions);
    const besoins        = norm(fam.besoins);
    const transmutation  = norm(fam.transmutation);
    const archetypes     = norm(fam.archetypes);
    const revelations    = norm(fam.revelations);
    const actions        = norm(fam.actions);
    const memoireCosmos  = safe(body?.memoireCosmos);

    if (!emotions.carte || !besoins.carte || !transmutation.carte || !archetypes.carte || !revelations.carte || !actions.carte) {
      return res.status(400).json({ error: "Familles incomplètes pour le Tore" });
    }

    // Cartes passerelles (serveur)
    const isPass = (polCarte, polPiece) => (polCarte !== "—" && polPiece !== "—" && polCarte !== polPiece);
    const pass = {
      emotions:      isPass(emotions.polarite,      emotions.piece),
      besoins:       isPass(besoins.polarite,       besoins.piece),
      transmutation: isPass(transmutation.polarite, transmutation.piece),
      archetypes:    isPass(archetypes.polarite,    archetypes.piece),
      revelations:   isPass(revelations.polarite,   revelations.piece),
      actions:       isPass(actions.polarite,       actions.piece),
    };

    // ——— Prompt strict : symboles + explication féminine/masculine, "cartes passerelles" ———
    const SYSTEM = `
Tu es l’analyste officiel d’Oradia pour le Tirage du Tore.

Règles :
- Polarité : affiche toujours le symbole (⚫ ou 🔺).
  ⚫ = énergie féminine, 🔺 = énergie masculine. Tu peux rappeler cette correspondance de manière simple.
- "Carte passerelle" UNIQUEMENT si le drapeau fourni (passerelle=true) pour la ligne concernée.
- Familles (par lignes) :
  L1 — ÉMOTIONS
  L2 — BESOINS
  L3 — TRANSMUTATIONS
  L4 — ARCHÉTYPES
  L5 — RÉVÉLATIONS
  L6 — ACTIONS
  L7 — MÉMOIRES COSMOS (sans polarité propre).
- Style Oradia : poétique, clair, ancré ; relie l’ensemble à l’intention.

Affichage final (sans préambule, sans visuel) :
Votre Tirage du Tore:
Ligne 1 – ÉMOTIONS       : {NomCarte} ({Symbole} = énergie féminine/masculine) {— carte passerelle : … si passerelle=true}
Ligne 2 – BESOINS        : {…}
Ligne 3 – TRANSMUTATIONS : {…}
Ligne 4 – ARCHÉTYPES     : {…}
Ligne 5 – RÉVÉLATIONS    : {…}
Ligne 6 – ACTIONS        : {…}
Carte Mémoires Cosmos :
{…}
Synthèse du tirage :
{…}
`.trim();

    const USER = `
Intention: ${safe(body.intention)}

Entrées normalisées (ne pas modifier les symboles) + flags passerelle:
- L1 ÉMOTIONS      : nom="${emotions.carte}",       symbole="${emotions.polarite}",       piece="${emotions.piece}",       passerelle=${pass.emotions}
- L2 BESOINS       : nom="${besoins.carte}",        symbole="${besoins.polarite}",        piece="${besoins.piece}",        passerelle=${pass.besoins}
- L3 TRANSMUTATIONS: nom="${transmutation.carte}",  symbole="${transmutation.polarite}",  piece="${transmutation.piece}",  passerelle=${pass.transmutation}
- L4 ARCHÉTYPES    : nom="${archetypes.carte}",     symbole="${archetypes.polarite}",     piece="${archetypes.piece}",     passerelle=${pass.archetypes}
- L5 RÉVÉLATIONS   : nom="${revelations.carte}",    symbole="${revelations.polarite}",    piece="${revelations.piece}",    passerelle=${pass.revelations}
- L6 ACTIONS       : nom="${actions.carte}",        symbole="${actions.polarite}",        piece="${actions.piece}",        passerelle=${pass.actions}
- L7 MÉMOIRES COSMOS: "${memoireCosmos}"

Consignes :
- Réutilise EXACTEMENT les symboles fournis (🔺, ⚫, ou '—' → alors pas de symbole).
- Ajoute “— carte passerelle : …” UNIQUEMENT si passerelle=true sur la ligne correspondante.
- Mention explicative possible : "(⚫ = énergie féminine, 🔺 = énergie masculine)" lorsque pertinent.
`.trim();

    console.log("API Key côté serveur ?", process.env.OPENAI_API_KEY ? "OK" : "ABSENTE");

    // Timeout (25s)
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
        max_tokens: 1100,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER }
        ]
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));

    if (!r.ok) {
      const err = await r.text();
      console.error("[OpenAI ERROR][tore]", err);
      return res.status(502).json({ error: "Analyse indisponible. Réessaie dans un instant." });
    }

    const data = await r.json();
    const texte = (data.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur [tore]:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
