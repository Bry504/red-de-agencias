/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// === ENV GHL / LEADCONNECTOR ===
const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;
const GHL_PIPELINE_ID = process.env.GHL_PIPELINE_ID!;
const GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA =
  process.env.GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA!;

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
        {
          error:
            'Faltan campos obligatorios (nombre, apellido o celular).',
        },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------------------
    // 1. Validar duplicado en tabla contactos
    // ----------------------------------------------------------------------
    const { data: exists } = await supabase
      .from('contactos')
      .select('id')
      .eq('celular', celular)
      .maybeSingle();

    if (exists) {
      return NextResponse.json(
        {
          error:
            'El número de celular ya está registrado en la Base de Datos.',
        },
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
    // 3. Headers base para LeadConnector
    // ----------------------------------------------------------------------
    const baseHeaders = {
      Authorization: `Bearer ${GHL_API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      'Location-Id': GHL_LOCATION_ID,
    } as const;

    const phoneE164 = celular ? `+51${celular}` : undefined;

    // ----------------------------------------------------------------------
    // 4. Notas para el contacto
    // ----------------------------------------------------------------------
    const notas = [
      lugarProspeccion && `Lugar: ${lugarProspeccion}`,
      proyectoInteres && `Proyecto: ${proyectoInteres}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      modalidadPago && `Pago: ${modalidadPago}`,
      documentoIdentidad &&
        `Doc. identidad: ${documentoIdentidad}`,
      comentarios && `Comentarios: ${comentarios}`,
    ]
      .filter(Boolean)
      .join(' | ');

    // ----------------------------------------------------------------------
    // 5. Crear / upsert contacto en GHL (LeadConnector)
    // ----------------------------------------------------------------------
    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      firstName: nombre,
      lastName: apellido,
      email: email || undefined,
      phone: phoneE164,
      source: 'CAMPO',
      notes: notas,
      assignedTo: ownerId,
    };

    const contactRes = await fetch(
      'https://services.leadconnectorhq.com/contacts/upsert',
      {
        method: 'POST',
        headers: baseHeaders,
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

    const contactJson: any = await contactRes.json().catch(() => ({}));
    const contactId =
      contactJson?.id ||
      contactJson?.contact?.id ||
      contactJson?.contactId;

    if (!contactId) {
      console.error('GHL contact sin id:', contactJson);
      return NextResponse.json(
        { error: 'No se obtuvo el ID de contacto en GHL.' },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------------
    // 6. Crear oportunidad en GHL en pipeline fijo + stage OPORTUNIDAD RECIBIDA
    // ----------------------------------------------------------------------
    const opportunityPayload = {
      locationId: GHL_LOCATION_ID,
      contactId,
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
      status: 'open',
      source: 'CAMPO',
      name: `${nombre} ${apellido}`,
      assignedTo: ownerId,
    };

    const oppRes = await fetch(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(opportunityPayload),
      }
    );

    if (!oppRes.ok) {
      const text = await oppRes.text().catch(() => '');
      console.error('GHL opportunity error:', oppRes.status, text);
      return NextResponse.json(
        { error: 'No se pudo crear la oportunidad en GHL.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, message: 'Prospecto creado correctamente.' },
      { status: 201 }
    );
  } catch (err) {
    console.error('Error interno /api/tradicional/campo:', err);
    return NextResponse.json(
      { error: 'Error interno.' },
      { status: 500 }
    );
  }
}