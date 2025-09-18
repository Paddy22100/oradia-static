// pages/api/analyse-tore.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  // Clé serveur
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};

    // Normalisation
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const norm = o => ({ carte: safe(o?.carte), polarite: safe(o?.polarite), piece: safe(o?.piece) });

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

    // ——— Prompt "canon" Tore ———
    // Règles:
    // - Polarité: triangle (🔺) = énergie masculine ; rond (⚫) = énergie féminine. N’emploie aucun autre terme.
    // - "Carte passerelle" si la pièce (🔺/⚫) ≠ polarité de la carte; formuler la passerelle.
    // - Familles du Tore: L1 ÉMOTIONS, L2 BESOINS, L3 TRANSMUTATIONS, L4 ARCHÉTYPES, L5 RÉVÉLATIONS, L6 ACTIONS, L7 MÉMOIRES COSMOS.
    // - Mémoire Cosmos: pas de polarité propre.
    const SYSTEM = `
Tu es l’analyste officiel d’Oradia pour le Tirage du Tore.

Règles strictes:
- Polarité: utiliser seulement triangle (🔺) pour l’énergie masculine et rond (⚫) pour l’énergie féminine.
- Lorsque pièce ≠ polarité carte: parler de "carte passerelle" (PAS "mutante") et formuler clairement la passerelle (transition, recadrage, opportunité).
- Familles: 
  L1 — ÉMOTIONS
  L2 — BESOINS
  L3 — TRANSMUTATIONS
  L4 — ARCHÉTYPES
  L5 — RÉVÉLATIONS
  L6 — ACTIONS
  L7 — MÉMOIRES COSMOS (sans polarité).
- Style Oradia: poétique, ancré, accessible; relier l’ensemble à l’intention; pas de visuels.

Affichage final EXACT (sans préambule):
Votre Tirage du Tore:
Ligne 1 – ÉMOTIONS       : {NomCarte} ({🔺/⚫}) {— carte passerelle : … si pièce ≠ polarité carte}
Ligne 2 – BESOINS        : {…}
Ligne 3 – TRANSMUTATIONS : {…}
Ligne 4 – ARCHÉTYPES     : {…}
Ligne 5 – RÉVÉLATIONS    : {…}
Ligne 6 – ACTIONS        : {…}
Carte Mémoires Cosmos :
{…}
Synthèse du tirage :
{… (claire, reliée à l’intention)}
`.trim();

    const USER = `
Intention: ${safe(body.intention)}

Familles tirées:
- L1 ÉMOTIONS      : ${emotions.carte} | polarité carte: ${emotions.polarite} | pièce: ${emotions.piece}
- L2 BESOINS       : ${besoins.carte} | polarité carte: ${besoins.polarite} | pièce: ${besoins.piece}
- L3 TRANSMUTATIONS: ${transmutation.carte} | polarité carte: ${transmutation.polarite} | pièce: ${transmutation.piece}
- L4 ARCHÉTYPES    : ${archetypes.carte} | polarité carte: ${archetypes.polarite} | pièce: ${archetypes.piece}
- L5 RÉVÉLATIONS   : ${revelations.carte} | polarité carte: ${revelations.polarite} | pièce: ${revelations.piece}
- L6 ACTIONS       : ${actions.carte} | polarité carte: ${actions.polarite} | pièce: ${actions.piece}

Carte MÉMOIRES COSMOS: ${memoireCosmos}

Rappels:
- Triangle (🔺) = énergie masculine ; Rond (⚫) = énergie féminine.
- Dire "carte passerelle" si pièce ≠ polarité carte, et formuler la passerelle.
- Ne pas attribuer de polarité à la carte Mémoires Cosmos.

Rends UNIQUEMENT la structure demandée ci-dessus, remplie et propre.
`.trim();

    console.log("API Key visible côté serveur ?", process.env.OPENAI_API_KEY ? "OK" : "ABSENTE");

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
