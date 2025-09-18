// pages/api/analyse-traversee.js
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
    const b = body.boussole || {};

    // Normalisation d’entrée
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const pick = o => ({ carte: safe(o?.carte), polarite: safe(o?.polarite) });

    const nord  = pick(b.nord);
    const sud   = pick(b.sud);
    const est   = pick(b.est);
    const ouest = pick(b.ouest);

    if (!nord.carte || !sud.carte || !est.carte || !ouest.carte) {
      return res.status(400).json({ error: "Boussole incomplète" });
    }

    // ——— Prompt "canon" Traversée ———
    // Rappels de vocabulaire/structure:
    // - Polarité: utiliser UNIQUEMENT les symboles universels: triangle (🔺) = énergie masculine ; rond (⚫) = énergie féminine.
    // - Parler de "cartes passerelles" (PAS de mutantes) lorsque la pièce (tirée: 🔺/⚫) est différente de la polarité fixe de la carte.
    // - Familles Traversée: L1 ÉMOTIONS, L2 BESOINS, L3 RÉVÉLATIONS, L4 ACTIONS, + 1 carte MÉMOIRES COSMOS (sans polarité propre).
    // - Mémoire Cosmos n’a PAS de polarité; ne pas lui en attribuer.
    // - Style Oradia: poétique, incarné, non ésotérique obscur; relier clairement à l’intention.
    const SYSTEM = `
Tu es l’analyste officiel d’Oradia pour le Tirage de la Traversée.

Règles de forme et de fond (à respecter strictement):
- Polarité: utilise seulement triangle (🔺) pour l’énergie masculine et rond (⚫) pour l’énergie féminine. N’emploie jamais d’autres termes.
- Lorsque la polarité de la PIÈCE tirée (🔺/⚫) diffère de la polarité FIXE de la carte: désigne la carte comme "carte passerelle" et formule la passerelle correspondante (transition, recadrage, opportunité).
- Familles présentes (par lignes): 
  L1 — ÉMOTIONS
  L2 — BESOINS
  L3 — RÉVÉLATIONS
  L4 — ACTIONS
  Carte MÉMOIRES COSMOS (sans polarité propre).
- Affichage final EXACT (sans préambule, sans visuel) :

Votre Tirage de la traversée:
Ligne 1 – ÉMOTIONS : {NomCarte} ({🔺 ou ⚫}) {— carte passerelle : … si la pièce ≠ polarité carte}
Ligne 2 – BESOINS   : {…}
Ligne 3 – RÉVÉLATIONS : {…}
Ligne 4 – ACTIONS   : {…}
Carte Mémoires Cosmos :
{…}
Synthèse du tirage :
{… (ancrée, claire, reliée à l’intention)}

- Si des données de profil (HD, Ennéagramme, Astro, etc.) manquent, reste générique, n’invente rien.
`.trim();

    const USER = `
Intention: ${safe(body.intention)}

Cartes tirées:
- NORD (ÉMOTIONS): ${nord.carte} | polarité carte: ${nord.polarite} | pièce: ${safe(body?.mutations?.emotionsPiece)}
- SUD  (BESOINS): ${sud.carte} | polarité carte: ${sud.polarite} | pièce: ${safe(body?.mutations?.besoinsPiece)}
- EST  (RÉVÉLATIONS): ${est.carte} | polarité carte: ${est.polarite} | pièce: ${safe(body?.mutations?.revelationsPiece)}
- OUEST(ACTIONS): ${ouest.carte} | polarité carte: ${ouest.polarite} | pièce: ${safe(body?.mutations?.actionsPiece)}

Carte MÉMOIRES COSMOS: ${safe(body?.memoireCosmos)}

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
