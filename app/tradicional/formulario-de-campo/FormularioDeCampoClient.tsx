// app/tradicional/formulario-de-campo/FormularioDeCampoClient.tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';


export default function FormularioDeCampoClient() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usuarioId, setUsuarioId] = useState<string | null | undefined>(undefined);
  const searchParams = useSearchParams();
  const token = searchParams.get('t');

  // NUEVO: estado para geolocalización
  const [coords, setCoords] = useState<{ lat: number | null; lon: number | null }>({
    lat: null,
    lon: null,
  });

  // Leer ?t=... desde la URL en el CLIENTE
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('t');
      setUsuarioId(t);
    } catch (e) {
      console.error('Error leyendo search params:', e);
      setUsuarioId(null);
    }
  }, []);

  // NUEVO: intentar obtener latitud/longitud del navegador
  useEffect(() => {
    if (!navigator?.geolocation) {
      console.warn('Geolocalización no soportada por el navegador.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn('No se pudo obtener geolocalización:', err);
        // No lanzamos error al usuario; simplemente se quedará sin lat/lon
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 4_000,
      }
    );
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMsg(null);

    if (!usuarioId) {
      setError('Link inválido: falta el identificador de usuario (t).');
      return;
    }

    const formData = new FormData(e.currentTarget);

    const nombre = (formData.get('nombre') as string)?.trim();
    const apellido = (formData.get('apellido') as string)?.trim();
    const celular = (formData.get('celular') as string)?.trim();

    if (!nombre || !apellido || !celular) {
      setError('Nombre, apellido y celular son obligatorios.');
      return;
    }

    const celularClean = celular.replace(/\D/g, '');
    if (!/^9\d{8}$/.test(celularClean)) {
      setError('El celular debe ser peruano: 9 dígitos y empezar en 9.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/tradicional/campo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuarioId,
          lugarProspeccion: formData.get('lugarProspeccion') || null,
          nombre,
          apellido,
          celular: celularClean,
          documentoIdentidad: formData.get('documentoIdentidad') || null,
          email: formData.get('email') || null,
          proyectoInteres: formData.get('proyectoInteres') || null,
          presupuesto: formData.get('presupuesto') || null,
          modalidadPago: formData.get('modalidadPago') || null,
          comentarios: formData.get('comentarios') || null,

          // NUEVO: mandar lat/lon al backend
          lat: coords.lat,
          lon: coords.lon,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(
          json.error ||
            'Error al registrar el prospecto, contáctese con Bryant Huamaní.'
        );
      } else {
        setMsg('Prospecto registrado correctamente.');
        (e.target as HTMLFormElement).reset();
      }
    } catch (err) {
      console.error('Error en submit:', err);
      setError('Error de conexión.');
    } finally {
      setLoading(false);
    }
  };

  // Mientras aún no sabemos el valor de t (primer render)
  if (usuarioId === undefined) {
    return (
      <main
        className="min-h-screen flex items-center justify-center bg-[#fde9d9]"
        style={{ fontFamily: '"Times New Roman", Times, serif' }}
      >
        <p>Cargando formulario...</p>
      </main>
    );
  }

  // Ya leímos la URL y NO hay t
  if (!usuarioId) {
    return (
      <main
        className="min-h-screen flex items-center justify-center bg-[#fde9d9]"
        style={{ fontFamily: '"Times New Roman", Times, serif' }}
      >
        <p>
          Link inválido. Falta el parámetro <code>t</code>.
        </p>
      </main>
    );
  }

  // Todo OK: mostramos el formulario
  return (
  <main
    className="min-h-screen flex flex-col items-center justify-start bg-[#fde9d9] px-4 pt-6 pb-10"
    style={{ fontFamily: '"Times New Roman", Times, serif' }}
  >
    {/* TÍTULOS FUERA DEL CUADRO */}
    <div className="text-center mb-4">
      <h1 className="text-3xl sm:text-4xl font-bold text-[#d4551f]">
        REALTY GRUPO INMOBILIARIO
      </h1>
      <h2 className="text-lg sm:text-xl mt-1 text-[#b1451b]">
        Registro de prospectos de campo
      </h2>
    </div>

    {/* FORMULARIO EN EL CUADRO BLANCO */}
    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-6 sm:p-8 my-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Lugar de prospección */}
        <div>
          <label className="block font-semibold mb-1 text-black">
            Lugar de prospección
          </label>
          <input
            name="lugarProspeccion"
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2"
            placeholder="Ej: Jockey Plaza, Mercado Unicachi, Centro de Lima, etc."
          />
        </div>

        {/* Nombre */}
        <div>
          <label className="block font-semibold mb-1 text-black">
            Nombre <span className="text-red-500">*</span>
          </label>
          <input
            name="nombre"
            required
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2"
          />
        </div>

        {/* Apellido */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Apellido <span className="text-red-500">*</span>
            </label>
            <input
              name="apellido"
              required
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>

          {/* Celular */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Celular (Perú) <span className="text-red-500">*</span>
            </label>
            <input
              name="celular"
              required
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="9 dígitos"
            />
          </div>

          {/* Documento de identidad */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Documento de identidad
            </label>
            <input
              name="documentoIdentidad"
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="DNI: 8 dígitos / CE: 9-12 dígitos"
            />
          </div>

          {/* Correo electrónico */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Correo electrónico
            </label>
            <input
              name="email"
              type="email"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="nombre_del_correo@dominio.com"
            />
          </div>

          {/* Proyecto de interés */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Proyecto de interés
            </label>
            <select
              name="proyectoInteres"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              defaultValue="NINGUNO"
            >
              <option value="NINGUNO">NINGUNO</option>
              <option value="Bosques de Calango">Bosques de Calango</option>
              <option value="Asia Pacific Condominio">
                Asia Pacific Condominio
              </option>
              <option value="Pachacamac Luxury">Pachacamac Luxury</option>
              <option value="Paracas Realty Beach">Paracas Realty Beach</option>
              <option value="Toscana Garden">Toscana Garden</option>
              <option value="Buonavista">Buonavista</option>
              <option value="Altavista">Altavista</option>
            </select>
          </div>

          {/* Presupuesto */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Presupuesto
            </label>
            <select
              name="presupuesto"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              defaultValue=""
            >
              <option value="">Selecciona</option>
              <option value="5000-25000">$5 000 – $25 000</option>
              <option value="25000-50000">$25 000 – $50 000</option>
              <option value="50000-100000">$50 000 – $100 000</option>
              <option value="100000-200000">$100 000 – $200 000</option>
              <option value="200000+">$200 000 a más</option>
            </select>
          </div>

          {/* Modalidad de pago */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Modalidad de pago
            </label>
            <select
              name="modalidadPago"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              defaultValue=""
            >
              <option value="">Selecciona</option>
              <option value="financiado">Financiado</option>
              <option value="fraccionado">Fraccionado</option>
              <option value="contado">Al contado</option>
              <option value="plan 69">Plan 69</option>
            </select>
          </div>

          {/* Comentarios */}
          <div>
            <label className="block font-semibold mb-1 text-black">
              Comentario
            </label>
            <textarea
              name="comentarios"
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              rows={3}
              placeholder="Horarios de llamada, preferencia de comunicación, etc."
            />
          </div>

        {error && <p className="text-red-600">{error}</p>}
        {msg && <p className="text-green-600">{msg}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#d4551f] hover:bg-[#b1451b] text-white font-semibold py-2 rounded-md disabled:opacity-60"
        >
          {loading ? 'REGISTRANDO...' : 'REGISTRAR'}
        </button>
      </form>    
    </div>
    {/* Botón fuera del cuadro */}
    <div className="w-full max-w-2xl mt-4">
      <Link
        href={
          token
            ? `/tradicional/entorno-personal?t=${encodeURIComponent(token)}`
            : '/tradicional/entorno-personal'
        }
        className="block"
      >
        <button className="w-full bg-gray-700 hover:bg-gray-800 text-white font-semibold py-2 rounded-md shadow">
          Registrar entorno personal
        </button>
      </Link>
    </div>
  </main>
);
}