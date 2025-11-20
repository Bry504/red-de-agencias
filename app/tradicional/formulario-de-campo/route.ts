/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const GHL_API_KEY = process.env.GHL_API_KEY!;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!;

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
      return NextResponse.json({ error: 'Faltan campos obligatorios.' }, { status: 400 });
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
        { error: 'El número de celular ya está registrado.' },
        { status: 409 }
      );
    }

    // ----------------------------------------------------------------------
    // 2. Obtener ghl_id del usuario
    // ----------------------------------------------------------------------
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('ghl_id')
      .eq('id', usuarioId)
      .maybeSingle();

    if (!usuario?.ghl_id) {
      return NextResponse.json(
        { error: 'Usuario inválido o sin ghl_id asignado.' },
        { status: 400 }
      );
    }

    const ownerId = usuario.ghl_id;

    // ----------------------------------------------------------------------
    // 3. Obtener pipeline y stage desde GHL por nombre
    // ----------------------------------------------------------------------
    const pipelinesRes = await fetch(
      `https://rest.gohighlevel.com/v1/pipelines/?locationId=${GHL_LOCATION_ID}`,
      {
        headers: { Authorization: `Bearer ${GHL_API_KEY}` },
      }
    );

    const pipelinesJson = await pipelinesRes.json();

    const pipeline = pipelinesJson.pipelines?.find(
      (p: any) => p.name.toLowerCase() === 'cartera propia'
    );

    if (!pipeline) {
      return NextResponse.json(
        { error: 'No se encontró el pipeline "Cartera propia".' },
        { status: 500 }
      );
    }

    const stage = pipeline.stages.find(
      (s: any) => s.name.toLowerCase() === 'oportunidad recibida'
    );

    if (!stage) {
      return NextResponse.json(
        { error: 'No se encontró el stage "Oportunidad recibida".' },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------------
    // 4. Buscar custom field "contact.documento_de_identidad"
    // ----------------------------------------------------------------------
    let documentoFieldId = null;

    if (documentoIdentidad) {
      const fieldsRes = await fetch(
        `https://rest.gohighlevel.com/v1/custom-fields/?locationId=${GHL_LOCATION_ID}`,
        {
          headers: { Authorization: `Bearer ${GHL_API_KEY}` },
        }
      );

      const fieldsJson = await fieldsRes.json();

      const field = fieldsJson.customFields?.find(
        (f: any) =>
          f.name.toLowerCase() === 'contact.documento_de_identidad'
      );

      if (field) documentoFieldId = field.id;
    }

    // ----------------------------------------------------------------------
    // 5. Crear contacto en GHL
    // ----------------------------------------------------------------------
    const notas = [
      lugarProspeccion && `Lugar: ${lugarProspeccion}`,
      proyectoInteres && `Proyecto: ${proyectoInteres}`,
      presupuesto && `Presupuesto: ${presupuesto}`,
      modalidadPago && `Pago: ${modalidadPago}`,
      comentarios && `Comentarios: ${comentarios}`,
    ]
      .filter(Boolean)
      .join(' | ');

    const contactPayload: any = {
      locationId: GHL_LOCATION_ID,
      source: 'Campo',
      firstName: nombre,
      lastName: apellido,
      phone: celular,
      email,
      notes: notas,
    };

    if (documentoFieldId && documentoIdentidad) {
      contactPayload.customField = [
        { id: documentoFieldId, value: documentoIdentidad },
      ];
    }

    const contactRes = await fetch(
      'https://rest.gohighlevel.com/v1/contacts/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GHL_API_KEY}`,
        },
        body: JSON.stringify(contactPayload),
      }
    );

    if (!contactRes.ok) {
      const text = await contactRes.text();
      console.error(text);
      return NextResponse.json(
        { error: 'No se pudo crear el contacto en GHL.' },
        { status: 500 }
      );
    }

    const contactJson = await contactRes.json();
    const contactId = contactJson.id || contactJson.contactId || contactJson.contact?.id;

    // ----------------------------------------------------------------------
    // 6. Crear oportunidad en GHL
    // ----------------------------------------------------------------------
    const opportunityPayload = {
      title: `${nombre} ${apellido}`,
      contactId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      locationId: GHL_LOCATION_ID,
      assignedTo: ownerId,
    };

    const oppRes = await fetch(
      'https://rest.gohighlevel.com/v1/opportunities/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GHL_API_KEY}`,
        },
        body: JSON.stringify(opportunityPayload),
      }
    );

    if (!oppRes.ok) {
      const text = await oppRes.text();
      console.error(text);
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
    console.error(err);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}