from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Consumicion(db.Model):
    __tablename__ = 'consumiciones'

    id = db.Column(db.Integer, primary_key=True)
    nombre = db.Column(db.String(100), nullable=False)
    precio_unitario = db.Column(db.Float, nullable=False)
    imagen_url = db.Column(db.String(500), nullable=True)
    activo = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'nombre': self.nombre,
            'precio_unitario': round(self.precio_unitario, 2),
            'imagen_url': self.imagen_url,
            'activo': self.activo,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class Pedido(db.Model):
    __tablename__ = 'pedidos'

    id = db.Column(db.Integer, primary_key=True)
    fecha_hora = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    total_pedido = db.Column(db.Float, nullable=False)
    camarero = db.Column(db.String(50), nullable=True, default='Camarero')

    lineas = db.relationship('PedidoLinea', backref='pedido', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'fecha_hora': self.fecha_hora.isoformat(),
            'total_pedido': round(self.total_pedido, 2),
            'camarero': self.camarero,
            'lineas': [linea.to_dict() for linea in self.lineas]
        }

class PedidoLinea(db.Model):
    __tablename__ = 'pedidos_lineas'

    id = db.Column(db.Integer, primary_key=True)
    pedido_id = db.Column(db.Integer, db.ForeignKey('pedidos.id'), nullable=False)
    consumicion_id = db.Column(db.Integer, db.ForeignKey('consumiciones.id'), nullable=False)
    cantidad = db.Column(db.Integer, nullable=False)
    precio_unitario_en_el_momento = db.Column(db.Float, nullable=False)

    consumicion = db.relationship('Consumicion')

    def to_dict(self):
        return {
            'id': self.id,
            'pedido_id': self.pedido_id,
            'consumicion_id': self.consumicion_id,
            'nombre_consumicion': self.consumicion.nombre if self.consumicion else 'Consumición borrada',
            'cantidad': self.cantidad,
            'precio_unitario_en_el_momento': round(self.precio_unitario_en_el_momento, 2),
            'subtotal': round(self.cantidad * self.precio_unitario_en_el_momento, 2)
        }
