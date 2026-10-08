/**
 * ================================================================
 * DETECCION DE DATOS PERSONALES SENSIBLES
 * ================================================================
 * Revisa un texto (mensaje de chat o descripcion de un reporte publico) y
 * detecta datos que el usuario NO deberia necesitar compartir: telefonos,
 * correos, redes sociales/enlaces, direcciones, numeros de documento,
 * contraseñas o codigos de verificacion y numeros de tarjeta.
 *
 * Filosofia: proteger sin destruir la conversacion.
 *   - severity "warning": se le ADVIERTE al usuario y debe confirmar que
 *     de verdad quiere enviarlo (puede haber casos legitimos).
 *   - severity "block": solo para numeros de tarjeta validos (algoritmo de
 *     Luhn). Nunca hay una razon legitima para enviar el numero completo
 *     de una tarjeta por este chat, y el falso positivo es muy improbable.
 *
 * La misma logica se replica en el frontend (js/api.js -> detectSensitive)
 * para avisar ANTES de enviar; el backend vuelve a validar siempre.
 * ================================================================
 */

const RULES = [
  {
    type: 'email',
    label: 'correo electrónico',
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  },
  {
    // Celulares colombianos (3xx xxx xxxx), con o sin +57, y fijos 60x
    type: 'phone',
    label: 'número de teléfono',
    regex: /(?:\+?57[\s.-]?)?(?:\b3\d{2}|\b60\d)[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/,
  },
  {
    type: 'social',
    label: 'enlace o red social',
    regex: /(https?:\/\/|www\.|wa\.me|t\.me\/|instagram|facebook|tiktok|whatsapp|telegram|(^|\s)@[A-Za-z0-9_.]{3,})/i,
  },
  {
    type: 'address',
    label: 'dirección',
    regex: /\b(calle|cll|cl|carrera|cra|kr|kra|avenida|av|diagonal|dg|transversal|tv)\.?\s*\d+[a-z]?\s*(#|no\.?|n°)\s*\d+/i,
  },
  {
    type: 'id_document',
    label: 'número de documento de identidad',
    regex: /\b(c[eé]dula|c\.?\s?c\.?|documento|pasaporte|tarjeta de identidad|t\.?\s?i\.?)\D{0,15}\d[\d.\s]{5,13}\d\b/i,
  },
  {
    type: 'credential',
    label: 'contraseña o código de verificación',
    regex: /\b(contrase[ñn]a|clave|password|pin|c[oó]digo( de verificaci[oó]n| otp)?|otp)\b\s*(es|:|=)\s*\S{3,}/i,
  },
];

/** Algoritmo de Luhn: valida si una secuencia de 13-19 digitos es una tarjeta real. */
function passesLuhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsCardNumber(text) {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  return candidates.some((c) => {
    const digits = c.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
}

/**
 * @returns {{ type: string, label: string, severity: 'warning'|'block' }[]}
 */
function detectSensitiveData(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const findings = [];

  if (containsCardNumber(text)) {
    findings.push({ type: 'card', label: 'número de tarjeta bancaria', severity: 'block' });
  }

  for (const rule of RULES) {
    if (rule.regex.test(text)) {
      findings.push({ type: rule.type, label: rule.label, severity: 'warning' });
    }
  }
  return findings;
}

function describeFindings(findings) {
  return [...new Set(findings.map((f) => f.label))].join(', ');
}

module.exports = { detectSensitiveData, describeFindings, passesLuhn };