/**
 * ================================================================
 * MIGRACION DE CATEGORIAS (sin perder datos)
 * ================================================================
 * Deja la base de datos con las 5 categorias oficiales del sistema
 * (Billeteras, Gafas, Carteras, Documentos, Dispositivos):
 *
 *  1. Si ya existe la categoria con el nombre nuevo o con un nombre
 *     antiguo equivalente (ej. "Billeteras y dinero"), la RENOMBRA y la
 *     activa. Asi los reportes viejos conservan su categoria (mismo _id) y
 *     la IA los sigue comparando igual. Si no existe, la crea.
 *  2. Desactiva cualquier otra categoria (no se borra: los reportes viejos
 *     que la usan siguen mostrando su nombre, pero ya no se puede elegir
 *     para reportes nuevos).
 *  3. Mascotas: desactiva la categoria y CIERRA sus reportes
 *     (status "cerrado" + moderacion "rechazado"), de modo que dejan de
 *     aparecer en el buscador y dejan de participar en coincidencias.
 *     No se borran, para no destruir informacion de los usuarios.
 *
 * Es idempotente: se puede ejecutar varias veces sin efectos extra.
 *
 * Uso:  npm run migrate:categories
 * (tambien se ejecuta automaticamente dentro de `npm run seed`)
 * ================================================================
 */
const Category = require('../models/Category');
const Item = require('../models/Item');
const { OFFICIAL_CATEGORIES, PET_CATEGORY_NAMES } = require('../config/categories');

async function migrateCategories({ log = console.log } = {}) {
  const keepIds = [];

  for (const official of OFFICIAL_CATEGORIES) {
    const candidates = [official.name, ...official.aliases];
    let doc = await Category.findOne({ name: official.name });
    if (!doc) doc = await Category.findOne({ name: { $in: official.aliases } });

    if (doc) {
      const previousName = doc.name;
      doc.name = official.name;
      doc.icon = official.icon;
      doc.active = true;
      await doc.save();
      if (previousName !== official.name) log(`   · "${previousName}" renombrada a "${official.name}"`);
    } else {
      doc = await Category.create({ name: official.name, icon: official.icon, active: true });
      log(`   · creada "${official.name}"`);
    }
    keepIds.push(doc._id);

    // Si existian a la vez el nombre nuevo y un alias, los reportes del
    // alias se pasan a la categoria oficial para no dejar duplicados.
    const duplicates = await Category.find({ name: { $in: candidates }, _id: { $ne: doc._id } });
    for (const dup of duplicates) {
      const moved = await Item.updateMany({ category: dup._id }, { category: doc._id });
      dup.active = false;
      await dup.save();
      log(`   · "${dup.name}" fusionada en "${official.name}" (${moved.modifiedCount || 0} reportes)`);
    }
  }

  const petCategories = await Category.find({ name: { $in: PET_CATEGORY_NAMES } });
  for (const pet of petCategories) {
    const closed = await Item.updateMany(
      { category: pet._id },
      {
        status: 'cerrado',
        moderation: {
          status: 'rechazado',
          reason: 'Categoría eliminada: el sistema solo gestiona objetos perdidos y encontrados.',
          reviewedBy: null,
        },
      }
    );
    log(`   · categoría "${pet.name}" desactivada; ${closed.modifiedCount || 0} reportes cerrados`);
  }

  const deactivated = await Category.updateMany({ _id: { $nin: keepIds }, active: true }, { active: false });
  if (deactivated.modifiedCount) log(`   · ${deactivated.modifiedCount} categorías no oficiales desactivadas`);

  return { official: keepIds.length, deactivated: deactivated.modifiedCount || 0 };
}

module.exports = { migrateCategories };

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const connectDB = require('../config/db');
  connectDB()
    .then(async () => {
      console.log('Migrando categorías...');
      const result = await migrateCategories();
      console.log('✅ Migración completada:', result);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}