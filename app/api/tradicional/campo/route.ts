/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// === ENV de GHL ===
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
        { error: 'Faltan campos obligatorios (nombre, apellido o celular).' },
        { status: 400 }
      );
    }

    // ----------------------------------------------------------------------
    // 0. Validar que las envs de GHL estén presentes
    // ----------------------------------------------------------------------
    if (
      !GHL_API_KEY ||
      !GHL_LOCATION_ID ||
      !GHL_PIPELINE_ID ||
      !GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA
    ) {
      console.error('Faltan variables de entorno de GHL');
      return NextResponse.json(
        { error: 'Configuración de GHL incompleta. Contacte al administrador.' },
        { status: 500 }
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
        { error: 'El número de celular ya está registrado en la Base de Datos.' },
        { status: 409 }
      );
    }

    // ----------------------------------------------------------------------
    // 2. Obtener ghl_id del usuario (owner de la oportunidad)
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

    const ownerId = usuario.ghl_id;

    // ----------------------------------------------------------------------
    // 3. Buscar custom field "contact.documento_de_identidad" (opcional)
    // ----------------------------------------------------------------------
    let documentoFieldId: string | null = null;

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
          typeof f.name === 'string' &&
          f.name.toLowerCase() === 'contact.documento_de_identidad'
      );

      if (field) documentoFieldId = field.id;
    }

    // ----------------------------------------------------------------------
    // 4. Crear contacto en GHL (SIN notes → la nota va en otro endpoint)
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
      // OJO: aquí ya no va "notes"
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
      console.error('GHL contact error:', contactRes.status, text);
      return NextResponse.json(
        { error: 'No se pudo crear el contacto en GHL.' },
        { status: 500 }
      );
    }

    const contactJson = await contactRes.json();
    const contactId =
      contactJson.id || contactJson.contactId || contactJson.contact?.id;

    if (!contactId) {
      console.error('No se obtuvo contactId desde GHL:', contactJson);
      return NextResponse.json(
        { error: 'No se pudo obtener el ID de contacto en GHL.' },
        { status: 500 }
      );
    }

    // ----------------------------------------------------------------------
    // 4.b Crear NOTA en el contacto (opcional, no rompe el flujo si falla)
    // ----------------------------------------------------------------------
    if (notas) {
      try {
        const noteRes = await fetch(
          `https://rest.gohighlevel.com/v1/contacts/${contactId}/notes/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${GHL_API_KEY}`,
            },
            body: JSON.stringify({ body: notas }),
          }
        );

        if (!noteRes.ok) {
          const text = await noteRes.text();
          console.warn(
            'GHL note error (no bloqueante):',
            noteRes.status,
            text
          );
        }
      } catch (e) {
        console.warn('Error creando nota en GHL (no bloqueante):', e);
      }
    }

    // ----------------------------------------------------------------------
    // 5. Crear oportunidad en GHL
    // ----------------------------------------------------------------------
    const opportunityPayload = {
      title: `${nombre} ${apellido}`,
      contactId,
      pipelineId: GHL_PIPELINE_ID,
      stageId: GHL_STAGE_ID_OPORTUNIDAD_RECIBIDA,
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
    console.error(err);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}