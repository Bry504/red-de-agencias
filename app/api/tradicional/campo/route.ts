/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Usamos el mismo token tipo "pit-..." que ya tienes
const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID!;
const GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA =
  process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA!;

// Headers estándar de LeadConnector (como en tu otro proyecto)
const ghlHeaders = {
  Authorization: `Bearer ${GHL_API_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Version: '2021-07-28',
  'Location-Id': GHL_LOCATION_ID,
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
        { error: 'Faltan campos obligatorios (nombre, apellido o celular).' },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------------------
    // 1. Validar duplicado en tabla contactos (Supabase)
    // ----------------------------------------------------------------------
    const { data: exists } = await supabase
      .from('contactos')
      .select('id')
      .eq('celular', celular)
      .maybeSingle();

    if (exists) {
      return NextResponse.json(
        { error: 'El número de celular ya está registrado en la Base de Datos.' },
        { status: 409 }
      );
    }

    // ----------------------------------------------------------------------
    // 2. Obtener ghl_id del usuario (owner en GHL)
    // ----------------------------------------------------------------------
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('ghl_id')
      .eq('id', usuarioId)
      .maybeSingle();

    if (!usuario?.ghl_id) {
      return NextResponse.json(
        { error: 'Acceso revocado, muchas gracias.' },
        { status: 400 }
      );
    }

    const ownerId = String(usuario.ghl_id);

    // ----------------------------------------------------------------------
    // 3. Crear contacto en GHL (LeadConnector)
    // ----------------------------------------------------------------------
    const phoneE164 = `+51${celular}`; // ya validaste 9 dígitos en el client

    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre,
      lastName: apellido,
      phone: phoneE164,
      email: email || undefined,
      source: 'CAMPO',
    };

    // Si tienes un custom field para DNI/CE, acá lo podrías mapear:
    // contactPayload.customFields = [{ id: 'ID_DEL_CF_DNI', value: documentoIdentidad }];

    const contactRes = await fetch(
      'https://services.leadconnectorhq.com/contacts/upsert',
      {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify(contactPayload),
      }
    );

    if (!contactRes.ok) {
      const text = await contactRes.text().catch(() => '');
      console.error('GHL contact error:', contactRes.status, text);
      return NextResponse.json(
        { error: 'No se pudo crear el contacto en GHL.' },
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
      console.error('GHL contact response sin id:', contactJson);
      return NextResponse.json(
        { error: 'No se pudo obtener el ID de contacto en GHL.' },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------------
    // 4. Crear NOTA con todo el contexto
    // ----------------------------------------------------------------------
    const partesNota = [
      lugarProspeccion && `Lugar de prospección: ${lugarProspeccion}`,
      proyectoInteres && `Proyecto de interés: ${proyectoInteres}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      modalidadPago && `Modalidad de pago: ${modalidadPago}`,
      comentarios && `Comentario: ${comentarios}`,
      documentoIdentidad && `Documento de identidad: ${documentoIdentidad}`,
      `Celular: ${celular}`,
    ].filter(Boolean);

    const notaTexto = partesNota.join('\n');

    if (notaTexto) {
      try {
        const noteRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(
            contactId
          )}/notes`,
          {
            method: 'POST',
            headers: ghlHeaders,
            body: JSON.stringify({ body: notaTexto }),
          }
        );

        if (!noteRes.ok) {
          const text = await noteRes.text().catch(() => '');
          console.error('GHL note error:', noteRes.status, text);
          // No rompemos el flujo si falla la nota: solo log
        }
      } catch (e) {
        console.error('Error creando nota en GHL:', e);
      }
    }

    // ----------------------------------------------------------------------
    // 5. Crear OPORTUNIDAD en el pipeline / stage configurados
    // ----------------------------------------------------------------------
    const opportunityPayload = {
      locationId: GHL_LOCATION_ID,
      contactId: String(contactId),
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
      status: 'open',
      name: `${nombre} ${apellido}`,
      assignedTo: ownerId,
      source: 'CAMPO',
    };

    const oppRes = await fetch(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        method: 'POST',
        headers: ghlHeaders,
        body: JSON.stringify(opportunityPayload),
      }
    );

    if (!oppRes.ok) {
      const text = await oppRes.text().catch(() => '');
      console.error('GHL opportunity error:', oppRes.status, text);
      // Igual devolvemos 201 porque el contacto ya se creó correctamente
      return NextResponse.json(
        {
          ok: true,
          warning:
            'Contacto creado, pero no se pudo crear la oportunidad en GHL. Revisa logs.',
        },
        { status: 201 }
      );
    }

    // Si todo OK:
    return NextResponse.json(
      { ok: true, message: 'Prospecto creado correctamente.' },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}