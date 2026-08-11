from models import db, Consumicion

INITIAL_CONSUMICIONS = [
    {
       
       "nombre": "Caña / Cervexa",
       "precio_unitario": 2,
       "imagen_url": "/static/img/canha.png",
       "activo": True,
    
     },
     {
     
       "nombre": "Auga",
       "precio_unitario": 1,
       "imagen_url": "/static/img/agua.png",
       "activo": True,
       
     },
     {
      
       "nombre": "Refresco",
       "precio_unitario": 2,
       "imagen_url": "/static/img/refresco.png",
       "activo": True,
       
     },
     {
      
       "nombre": "Copa / Combinado",
       "precio_unitario": 5,
       "imagen_url": "/static/img/copa.png",
       "activo": True,
      
     },
     {
     
       "nombre": "Calimotxo",
       "precio_unitario": 3,
       "imagen_url": "/static/img/calimotxo.png",
       "activo": True,
      
     }
]

def seed_database():
    if Consumicion.query.count() == 0:
        for item in INITIAL_CONSUMICIONS:
            c = Consumicion(
                nombre=item["nombre"],
                precio_unitario=item["precio_unitario"],
                imagen_url=item["imagen_url"],
                activo=item["activo"]
            )
            db.session.add(c)
        db.session.commit()
        print("Base de datos inicializada con consumicións por defecto en Galego.")
