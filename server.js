import express from "express";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Railway: SIEMPRE escuchar en process.env.PORT
const PORT = process.env.PORT || 8080;

// Modelo configurable por variable de entorno
const MODEL = process.env.MODEL || "gpt-4o-mini";

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

Formato:
- Máximo 8 líneas.
- Profesional, cálido y directo.
- No prometer resultados.
- No dar montos exactos.
- No pedir datos sensibles.

Estructura obligatoria:
1) Validación breve.
2) Explicación general con “sí es posible promover legalmente…”
3) Invitación a cita gratuita.
4) Cierre obligatorio con la pregunta de horario.

Si el prospecto confirma que quiere cita:
Ofrecer horarios de lunes a viernes de 10:30 a.m. a 6:30 p.m.

Si pide domicilio:
Responder exactamente:

${ADDRESS_BLOCK}

Si se confirma la cita:
Responder:
“Su cita ha quedado establecida.
Le atenderá el abogado Raúl James.
Muchas gracias 😊”.
`.trim();

// Helpers
function normalizeText(v) {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function looksLikeAddressRequest(text) {
  const t = text.toLowerCase();
  return (
    t.includes("domicilio") ||
    t.includes("dirección") ||
    t.includes("direccion") ||
    t.includes("ubicación") ||
    t.includes("ubicacion") ||
    t.includes("donde están") ||
    t.includes("dónde están") ||
    t.includes("mapa")
  );
}

function looksLikeAppointmentConfirmed(text) {
  const t = text.toLowerCase();
  return (
    t.includes("confirmo") ||
    t.includes("confirmar") ||
    t.includes("sí quiero la cita") ||
    t.includes("si quiero la cita") ||
    t.includes("quiero cita") ||
    t.includes("me interesa la cita") ||
    (t.includes("agendar") && (t.includes("confirm") || t.includes("listo")))
  );
}

function looksLikeHardConfirm(text) {
  const t = text.toLowerCase();
  return (
    t.includes("confirmada") ||
    t.includes("queda confirmada") ||
    t.includes("queda agendada") ||
    t.includes("ya quedó") ||
    t.includes("ya quedo") ||
    t.includes("listo, gracias") ||
    t.includes("perfecto, gracias") ||
    t.includes("de acuerdo, gracias")
  );
}

async function callOpenAI(userMessage) {
  const apiKey = process.env.OPENAI_API_KEY;

  // Si falta API Key, fallback controlado
  if (!apiKey) {
    return "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. Le invito a una cita gratuita presencial. ¿Su cita la desea por la mañana o por la tarde?";
  }

  const payload = {
    model: MODEL,
    input: [
      { role: "system", content: BASE_PROMPT },
      { role: "user", content: `Mensaje del prospecto: ${userMessage}` }
    ],
    max_output_tokens: 220
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  // Si OpenAI falla, fallback
  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    console.error("OpenAI error status:", r.status, errText);
    return "Entiendo su situación y con gusto le orientamos. Sí es posible promover legalmente acciones conforme al caso. Le invito a una cita gratuita presencial para revisar su situación. ¿Su cita la desea por la mañana o por la tarde?";
  }

  const data = await r.json();

  // Extraer texto de Responses API
  const out =
    data?.output?.[0]?.content?.find?.((c) => c.type === "output_text")?.text ??
    data?.output?.[0]?.content?.[0]?.text ??
    data?.output_text ??
    "";

  let text = normalizeText(out);

  if (!text) {
    text =
      "Entiendo su situación y con gusto le orientamos. Sí es posible promover legalmente acciones conforme al caso. Le invito a una cita gratuita presencial para revisar su situación. ¿Su cita la desea por la mañana o por la tarde?";
  }

  // Enforce máximo 8 líneas
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 8) {
    text = lines.slice(0, 8).join("\n");
  }

  return text;
}

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "whato-webhook", status: "healthy" });
});

// Probar en navegador
app.get("/webhook", (req, res) => {
  res.status(200).json({ ok: true, message: "Webhook activo" });
});

// Main webhook
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};

    // Whato puede enviar distintas llaves: probamos varias
    const incoming =
      body.message_content ??
      body.message ??
      body.text ??
      body.body ??
      body?.data?.message ??
      "";

    const userMessage = normalizeText(incoming);

    // Si llega vacío, responde algo seguro
    if (!userMessage) {
      const fallback = "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. Le invito a una cita gratuita presencial. ¿Su cita la desea por la mañana o por la tarde?";
      return res.status(200).json({ ok: true, reply: fallback, message: fallback, text: fallback });
    }

    // 1) Domicilio
    if (looksLikeAddressRequest(userMessage)) {
      return res.status(200).json({
        ok: true,
        reply: ADDRESS_BLOCK,
        message: ADDRESS_BLOCK,
        text: ADDRESS_BLOCK
      });
    }

    // 2) Confirmación fuerte
    if (looksLikeHardConfirm(userMessage)) {
      const confirmText = "Su cita ha quedado establecida.\nLe atenderá el abogado Raúl James.\nMuchas gracias 😊";
      return res.status(200).json({
        ok: true,
        reply: confirmText,
        message: confirmText,
        text: confirmText
      });
    }

    // 3) Quieren cita (disponibilidad)
    if (looksLikeAppointmentConfirmed(userMessage)) {
      const extra = "Horarios: lunes a viernes de 10:30 a.m. a 6:30 p.m.";
      const ai = await callOpenAI(userMessage);
      const combined = `${ai}\n${extra}`.split("\n").slice(0, 8).join("\n");
      return res.status(200).json({
        ok: true,
        reply: combined,
        message: combined,
        text: combined
      });
    }

    // 4) General con IA
    const reply = await callOpenAI(userMessage);

    // Respondemos con varias llaves para compatibilidad
    return res.status(200).json({
      ok: true,
      reply,
      message: reply,
      text: reply
    });
  } catch (err) {
    console.error("Webhook error:", err);
    const fallback =
      "Gracias por su mensaje. Sí es posible promover legalmente alternativas conforme al caso. Le invito a una cita gratuita presencial. ¿Su cita la desea por la mañana o por la tarde?";
    return res.status(200).json({ ok: false, reply: fallback, message: fallback, text: fallback });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
