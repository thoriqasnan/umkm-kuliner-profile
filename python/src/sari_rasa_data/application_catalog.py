"""Authoritative analytics/ML projection of the application's seeded catalog.

Values mirror ``db/database.js`` ``seedProducts``. Demand weights are synthetic
generation parameters only; identity, name, category, and price are application
domain facts.
"""

APPLICATION_PRODUCT_CATALOG = (
    {"product_id": "1", "product_name": "Nasi Goreng Spesial", "category": "makanan", "unit_price": 20000, "weight": 12},
    {"product_id": "2", "product_name": "Ayam Geprek Sambal Matah", "category": "makanan", "unit_price": 22000, "weight": 10},
    {"product_id": "3", "product_name": "Soto Ayam Kampung", "category": "makanan", "unit_price": 20000, "weight": 8},
    {"product_id": "4", "product_name": "Mie Ayam Bakso", "category": "makanan", "unit_price": 18000, "weight": 9},
    {"product_id": "5", "product_name": "Es Teh Manis", "category": "minuman", "unit_price": 5000, "weight": 14},
    {"product_id": "6", "product_name": "Es Jeruk Peras", "category": "minuman", "unit_price": 8000, "weight": 10},
    {"product_id": "7", "product_name": "Kopi Susu Gula Aren", "category": "minuman", "unit_price": 15000, "weight": 9},
    {"product_id": "8", "product_name": "Es Kelapa Muda", "category": "minuman", "unit_price": 12000, "weight": 6},
    {"product_id": "9", "product_name": "Pisang Goreng Crispy", "category": "snack", "unit_price": 10000, "weight": 8},
    {"product_id": "10", "product_name": "Risoles Mayo", "category": "snack", "unit_price": 12000, "weight": 7},
    {"product_id": "11", "product_name": "Tahu Isi", "category": "snack", "unit_price": 8000, "weight": 7},
)

APPLICATION_CATALOG_IDENTITY = "sari_rasa_seed_products_11_v1"
