/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// GHL
const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID!;
const GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA =
  process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA!;

// custom fields de CONTACTO
const GHL_CF_ORIGEN_ID = process.env.GHL_CF_ORIGEN_ID!; // ORIGEN
const GHL_CF_DOC_IDENTIDAD_ID = process.env
  .GHL_CF_DOC_IDENTIDAD_ID!; // DOCUMENTO DE IDENTIDAD
const GHL_CF_LATITUD_ID = process.env.GHL_CF_LATITUD_ID!; // LATITUD
const GHL_CF_LONGITUD_ID = process.env.GHL_CF_LONGITUD_ID!; // LONGITUD

// headers estándar
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
      lat, // opcional, si luego lo envías desde el front
      lon, // opcional
    } = body;

    if (!usuarioId || !nombre || !apellido || !celular) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios (nombre, apellido o celular).' },
        { status: 400 }
      );
    }

    // 1) Validar duplicado en contactos (Supabase)
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

    // 2) Obtener ghl_id del usuario (owner)
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

    // 3) Crear contacto en GHL con customFields
    const phoneE164 = `+51${celular}`;

    const contactCustomFields: Array<{ id: string; value: string }> = [];

    // ORIGEN: CAMPO
    if (GHL_CF_ORIGEN_ID) {
      contactCustomFields.push({
        id: GHL_CF_ORIGEN_ID,
        value: 'Campo',
      });
    }

    // DOCUMENTO DE IDENTIDAD
    if (GHL_CF_DOC_IDENTIDAD_ID && documentoIdentidad) {
      contactCustomFields.push({
        id: GHL_CF_DOC_IDENTIDAD_ID,
        value: String(documentoIdentidad),
      });
    }

    // LATITUD
    if (GHL_CF_LATITUD_ID && typeof lat === 'number') {
      contactCustomFields.push({
        id: GHL_CF_LATITUD_ID,
        value: String(lat),
      });
    }

    // LONGITUD
    if (GHL_CF_LONGITUD_ID && typeof lon === 'number') {
      contactCustomFields.push({
        id: GHL_CF_LONGITUD_ID,
        value: String(lon),
      });
    }

    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre,
      lastName: apellido,
      phone: phoneE164,
      email: email || undefined,
    };

    if (contactCustomFields.length > 0) {
      // *** IMPORTANTE: debe ser customFields (plural) ***
      contactPayload.customFields = contactCustomFields;
    }

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

    // 4) Nota con contexto
    const partesNota = [
      lugarProspeccion && `Lugar de prospección: ${lugarProspeccion}`,
      proyectoInteres && `Proyecto de interés: ${proyectoInteres}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      modalidadPago && `Modalidad de pago: ${modalidadPago}`,
      comentarios && `Comentario: ${comentarios}`,
      documentoIdentidad && `Documento de identidad: ${documentoIdentidad}`,
      `Celular: ${celular}`,
      typeof lat === 'number' && typeof lon === 'number'
        ? `Coordenadas: ${lat}, ${lon}`
        : null,
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
        }
      } catch (e) {
        console.error('Error creando nota en GHL:', e);
      }
    }

    // 5) Crear oportunidad (sin customFields)
    const opportunityPayload = {
      locationId: GHL_LOCATION_ID,
      contactId: String(contactId),
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
      status: 'open',
      name: `${nombre} ${apellido}`,
      assignedTo: ownerId,
      source: 'Campo',
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
      return NextResponse.json(
        {
          ok: true,
          warning:
            'Contacto creado, pero no se pudo crear la oportunidad en GHL. Revisa logs.',
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { ok: true, message: 'Prospecto creado correctamente.' },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}