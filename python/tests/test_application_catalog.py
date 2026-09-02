from sari_rasa_data.application_catalog import APPLICATION_PRODUCT_CATALOG


def test_application_catalog_matches_authoritative_database_seed_contract():
    assert [
        (item["product_id"], item["product_name"], item["category"], item["unit_price"])
        for item in APPLICATION_PRODUCT_CATALOG
    ] == [
        ("1", "Nasi Goreng Spesial", "makanan", 20000),
        ("2", "Ayam Geprek Sambal Matah", "makanan", 22000),
        ("3", "Soto Ayam Kampung", "makanan", 20000),
        ("4", "Mie Ayam Bakso", "makanan", 18000),
        ("5", "Es Teh Manis", "minuman", 5000),
        ("6", "Es Jeruk Peras", "minuman", 8000),
        ("7", "Kopi Susu Gula Aren", "minuman", 15000),
        ("8", "Es Kelapa Muda", "minuman", 12000),
        ("9", "Pisang Goreng Crispy", "snack", 10000),
        ("10", "Risoles Mayo", "snack", 12000),
        ("11", "Tahu Isi", "snack", 8000),
    ]
    assert len({item["product_id"] for item in APPLICATION_PRODUCT_CATALOG}) == 11
    assert all(item["weight"] > 0 for item in APPLICATION_PRODUCT_CATALOG)
