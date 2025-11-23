/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ==============================
// Supabase
// ==============================
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ==============================
// Helpers
// ==============================
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface EntornoPersonalPayload {
  nombre_completo: string;
  celular?: string | null;
  proyecto_interes?: string | null;
  comentarios?: string | null;
}

// ==============================
// Handler
// ==============================
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);

    if (!isRecord(body)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload format' },
        { status: 400 }
      );
    }

    const payload = body as Partial<EntornoPersonalPayload>;

    const nombre_completo = (payload.nombre_completo ?? '').trim();
    const celularRaw = (payload.celular ?? '').trim() || null;
    const proyecto_interes = (payload.proyecto_interes ?? '').trim() || null;
    const comentarios = (payload.comentarios ?? '').trim() || null;

    if (!nombre_completo) {
      return NextResponse.json(
        { ok: false, error: 'El nombre completo es obligatorio.' },
        { status: 400 }
      );
    }

    // Normalizar celular a 9 dígitos (Perú), si viene
    let celular: string | null = null;
    if (celularRaw) {
      const digits = celularRaw.replace(/\D/g, '');
      celular = digits.slice(-9) || null;
    }

    // 1) Verificar que no exista otro contacto con el mismo nombre
    const { data: existingContact, error: existingError } = await supabase
      .from('contactos')
      .select('id')
      .eq('nombre_completo', nombre_completo)
      .maybeSingle();

    if (existingError) {
      console.error(
        '[ENTORNO-PERSONAL] Error buscando contacto existente:',
        existingError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_search_error' },
        { status: 500 }
      );
    }

    if (existingContact) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Ya existe un contacto registrado con ese nombre. Por favor revisa antes de crear uno nuevo.',
        },
        { status: 409 }
      );
    }

    // 2) Insertar contacto
    const { data: insertedContact, error: insertContactError } = await supabase
      .from('contactos')
      .insert([
        {
          nombre_completo,
          celular,
          proyecto_interes,
          canal: 'ENTORNO_PERSONAL', // etiqueta útil para distinguirlos
        },
      ])
      .select('id')
      .single();

    if (insertContactError) {
      console.error(
        '[ENTORNO-PERSONAL] Error insertando contacto:',
        insertContactError
      );
      return NextResponse.json(
        { ok: false, error: 'supabase_insert_contact_error' },
        { status: 500 }
      );
    }

    const contactoId = insertedContact.id as string;

    // 3) Insertar nota (si hay comentarios)
    if (comentarios) {
      const { error: noteError } = await supabase.from('notas').insert([
        {
          contacto: contactoId,
          nota: comentarios,
          pipeline: 'Cartera propia', // puedes cambiarlo si quieres otro valor
        },
      ]);

      if (noteError) {
        console.error(
          '[ENTORNO-PERSONAL] Error insertando nota:',
          noteError
        );
        // No rompemos todo el flujo por la nota; solo lo logueamos
      }
    }

    return NextResponse.json(
      {
        ok: true,
        contacto_id: contactoId,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[ENTORNO-PERSONAL] Error inesperado:', err);
    return NextResponse.json(
      { ok: false, error: 'unexpected_error' },
      { status: 500 }
    );
  }
}