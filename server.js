import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ADDRESS_BLOCK =
`📍Av de las Américas 1254, Col. Country Club, Guadalajara, Jalisco. C.P 44610. Piso 10.
Mapa: https://g.co/kgs/kyy6ef
☎️ 3341622071
🌎 https://tuabogadoenguadalajara.com`;

const BASE_PROMPT = `
Actúe como asistente de admisión de un despacho de Derecho Familiar en Guadalajara, Jalisco, México.
Responda SIEMPRE en trato formal, con empatía y claridad.
Su objetivo es:
1) Brindar orientación general sin asesoría definitiva.
2) Explicar que sí existen vías legales.
3) Conducir a agendar cita gratuita presencial.
4) Cerrar siempre con: “¿Su cita la desea por la mañana o por la tarde?”
Máximo 8 líneas.
No prometer resultados.
No dar montos exactos.
No pedir datos sensibles.
`.trim();

function normalizeText(v) {
  if (typeof v === "string") return v.trim();
  return "";
}

function looksLikeAddressRequest(text) {
  const t = text.toLowerCase();
  return t.includes("domicilio") || t.includes("dirección") || t.includes("direccion") || t.includes("ubicación");
}

async function callOpenAI(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: BASE_PROMPT },
        { role: "user", content: userMessage }
      ],
      max_tokens: 250
    });

    let text = response.choices[0].message.content.trim();
    const lines = text.split("\n").slice(0, 8);
    return lines.join("\n");

  } catch (err) {
    console.error("OpenAI error:", err);
    return "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. ¿Su cita la desea por la mañana o por la tarde?";
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "whato-webhook-legal", status: "healthy" });
});

app.post("/webhook", async (req, res) => {
  try {
    console.log("INCOMING /webhook keys:", Object.keys(req.body));

    const userMessage = normalizeText(req.body.message);

    if (!userMessage) {
      return res.json({ reply: "Mensaje recibido." });
    }

    if (looksLikeAddressRequest(userMessage)) {
      return res.json({ reply: ADDRESS_BLOCK });
    }

    const reply = await callOpenAI(userMessage);

    return res.json({ reply });

  } catch (error) {
    console.error("Webhook error:", error);
    return res.json({
      reply: "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. ¿Su cita la desea por la mañana o por la tarde?"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
