const asyncHandler = require('express-async-handler');
const City = require('../models/City');

const listCities = asyncHandler(async (req, res) => {
  const cities = await City.find({ active: true }).sort('name');
  res.json(cities);
});

const createCity = asyncHandler(async (req, res) => {
  const city = await City.create(req.body);
  res.status(201).json(city);
});

const updateCity = asyncHandler(async (req, res) => {
  const city = await City.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(city);
});

const deleteCity = asyncHandler(async (req, res) => {
  await City.findByIdAndUpdate(req.params.id, { active: false });
  res.json({ message: 'Ciudad desactivada' });
});

module.exports = { listCities, createCity, updateCity, deleteCity };
