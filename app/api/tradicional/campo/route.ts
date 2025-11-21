/* eslint-disable */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID!;
const GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA =
  process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA!;

// *** AMBOS SON CUSTOM FIELDS DEL CONTACTO ***
const GHL_CF_ORIGEN_ID = process.env.GHL_CF_ORIGEN_ID!;
const GHL_CF_DOC_IDENTIDAD_ID = process.env.GHL_CF_DOC_IDENTIDAD_ID!;

// Headers estándar LeadConnector
const ghlHeaders = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
  Version: "2021-07-28",
  "Location-Id": GHL_LOCATION_ID,
} as const;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      usuarioId,
      lugarProspeccion,
      nombre,
      apellido,
      celular,
      documentoIdentidad,
      email,
      proyectoInteres,
      presupuesto,
      modalidadPago,
      comentarios,
    } = body;

    if (!usuarioId || !nombre || !apellido || !celular) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios." },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // 1. Verificar duplicado en Supabase
    // ------------------------------------------------------------
    const { data: exists } = await supabase
      .from("contactos")
      .select("id")
      .eq("celular", celular)
      .maybeSingle();

    if (exists) {
      return NextResponse.json(
        { error: "El celular ya existe en la Base de Datos." },
        { status: 409 }
      );
    }

    // ------------------------------------------------------------
    // 2. Obtener owner/GHL ID del usuario
    // ------------------------------------------------------------
    const { data: usuario } = await supabase
      .from("usuarios")
      .select("ghl_id")
      .eq("id", usuarioId)
      .maybeSingle();

    if (!usuario?.ghl_id) {
      return NextResponse.json(
        { error: "Acceso revocado." },
        { status: 400 }
      );
    }

    const ownerId = String(usuario.ghl_id);

    // ------------------------------------------------------------
    // 3. Crear CONTACTO en GHL (SIN CONTACT.SOURCE)
    // ------------------------------------------------------------
    const phoneE164 = `+51${celular}`;

    const customFields = [];

    // ORIGEN = CAMPO (en contacto)
    if (GHL_CF_ORIGEN_ID) {
      customFields.push({
        id: GHL_CF_ORIGEN_ID,
        value: "CAMPO",
      });
    }

    // DOCUMENTO DE IDENTIDAD (en contacto)
    if (GHL_CF_DOC_IDENTIDAD_ID && documentoIdentidad) {
      customFields.push({
        id: GHL_CF_DOC_IDENTIDAD_ID,
        value: String(documentoIdentidad),
      });
    }

    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre,
      lastName: apellido,
      phone: phoneE164,
      email: email || undefined,
    };

    if (customFields.length > 0) {
      contactPayload.customField = customFields;
    }

    const contactRes = await fetch(
      "https://services.leadconnectorhq.com/contacts/upsert",
      {
        method: "POST",
        headers: ghlHeaders,
        body: JSON.stringify(contactPayload),
      }
    );

    if (!contactRes.ok) {
      const text = await contactRes.text().catch(() => "");
      console.error("GHL contact error:", text);
      return NextResponse.json(
        { error: "No se pudo crear el contacto en GHL." },
        { status: 500 }
      );
    }

    const contactJson = await contactRes.json().catch(() => ({}));
    const contactId =
      contactJson.id ||
      contactJson.contact?.id ||
      contactJson.data?.id ||
      contactJson.result?.id;

    if (!contactId) {
      console.error("No se obtuvo contactId:", contactJson);
      return NextResponse.json(
        { error: "No se pudo obtener el ID del contacto." },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------
    // 4. Crear NOTA
    // ------------------------------------------------------------
    const partesNota = [
      lugarProspeccion && `Lugar: ${lugarProspeccion}`,
      proyectoInteres && `Proyecto: ${proyectoInteres}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      modalidadPago && `Modalidad de pago: ${modalidadPago}`,
      comentarios && `Comentarios: ${comentarios}`,
      documentoIdentidad && `Documento de identidad: ${documentoIdentidad}`,
      `Celular: ${celular}`,
    ].filter(Boolean);

    const nota = partesNota.join("\n");

    if (nota) {
      const noteRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        {
          method: "POST",
          headers: ghlHeaders,
          body: JSON.stringify({ body: nota }),
        }
      );

      if (!noteRes.ok) {
        console.error("Error creando nota:", await noteRes.text());
      }
    }

    // ------------------------------------------------------------
    // 5. Crear OPORTUNIDAD (sin custom fields)
    // ------------------------------------------------------------
    const opportunityPayload = {
      locationId: GHL_LOCATION_ID,
      contactId: contactId,
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
      name: `${nombre} ${apellido}`,
      status: "open",
      assignedTo: ownerId,
      // ⚠ NO usamos source aquí
    };

    const oppRes = await fetch(
      "https://services.leadconnectorhq.com/opportunities/",
      {
        method: "POST",
        headers: ghlHeaders,
        body: JSON.stringify(opportunityPayload),
      }
    );

    if (!oppRes.ok) {
      console.error("Opportunity error:", await oppRes.text());
      return NextResponse.json(
        { warning: "Contacto creado, pero la oportunidad falló." },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { ok: true, message: "Prospecto creado correctamente." },
      { status: 201 }
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}