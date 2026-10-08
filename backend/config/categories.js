/**
 * ================================================================
 * CATEGORIAS OFICIALES DEL SISTEMA
 * ================================================================
 * El portal gestiona unicamente objetos perdidos y encontrados. Estas son
 * las cinco categorias con las que trabaja el sistema. Se usan en:
 *   - seed/seed.js y seed/migrateCategories.js (datos iniciales y migracion)
 *   - controllers/categoryController.js (bloqueo de categorias de animales)
 *
 * `aliases` son los nombres que tenian las categorias en versiones
 * anteriores del proyecto: la migracion RENOMBRA esos documentos en vez de
 * crear otros nuevos, para que los reportes existentes conserven su
 * categoria (mismo _id) y el motor de IA siga comparandolos igual.
 * ================================================================
 */
const OFFICIAL_CATEGORIES = [
  { name: 'Billeteras', icon: 'bi-wallet2', aliases: ['Billeteras y dinero'] },
  { name: 'Gafas', icon: 'bi-eyeglasses', aliases: [] },
  { name: 'Carteras', icon: 'bi-handbag', aliases: ['Mochilas y bolsos', 'Bolsos'] },
  { name: 'Documentos', icon: 'bi-file-earmark-text', aliases: [] },
  { name: 'Dispositivos', icon: 'bi-phone', aliases: ['Celulares y tecnología', 'Celulares y tecnologia', 'Tecnología'] },
];

// Nombres de la antigua categoria de mascotas (se desactiva y sus reportes se cierran)
const PET_CATEGORY_NAMES = ['Mascotas', 'Mascota'];

// Evita que se vuelva a crear una categoria de animales desde el panel admin
const PET_NAME_PATTERN = /mascota|animal|perr[oa]s?\b|gat[oa]s?\b|felin|canin/i;

module.exports = { OFFICIAL_CATEGORIES, PET_CATEGORY_NAMES, PET_NAME_PATTERN };