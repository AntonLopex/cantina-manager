import os
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from sqlalchemy import func

from models import db, Consumicion, Pedido, PedidoLinea
from seed import seed_database

app = Flask(__name__)

# Configuración da base de datos
db_url = os.environ.get('DATABASE_URL', 'sqlite:///cantina.db')
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024  # Límite de 2 MB para imaxes

# Directores de uploads
UPLOAD_FOLDER = os.path.join(app.root_path, 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}

db.init_app(app)

ADMIN_PIN = "calo"

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_auth(req):
    pin = req.headers.get('X-Admin-PIN') or req.args.get('pin') or (req.json.get('pin') if req.is_json and req.json else None)
    return pin == ADMIN_PIN

with app.app_context():
    db.create_all()
    seed_database()

@app.route('/')
def index():
    return render_template('index.html')

# API Endpoints

@app.route('/api/verify-pin', methods=['POST'])
def verify_pin():
    data = request.get_json() or {}
    pin = data.get('pin', '')
    if pin == ADMIN_PIN:
        return jsonify({'success': True, 'message': 'Contrasinal correcto'})
    return jsonify({'success': False, 'message': 'Contrasinal incorrecto'}), 401

@app.route('/api/consumiciones', methods=['GET'])
def get_consumiciones():
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    if include_inactive:
        if not check_auth(request):
            return jsonify({'error': 'Acceso non autorizado'}), 401
        items = Consumicion.query.order_by(Consumicion.nombre.asc()).all()
    else:
        items = Consumicion.query.filter_by(activo=True).order_by(Consumicion.nombre.asc()).all()
    
    return jsonify([item.to_dict() for item in items])

@app.route('/api/consumiciones', methods=['POST'])
def add_consumicion():
    if not check_auth(request):
        return jsonify({'error': 'Acceso non autorizado'}), 401

    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio_unitario', '0')
    
    if not nombre:
        return jsonify({'error': 'O nome é obrigatorio'}), 400
    
    try:
        precio = float(precio_str)
        if precio <= 0:
            return jsonify({'error': 'O prezo debe ser maior que zero'}), 400
    except ValueError:
        return jsonify({'error': 'Prezo non válido'}), 400

    imagen_url = request.form.get('imagen_url', '').strip()
    
    # Manexo de ficheiro de imaxe se se subiu
    if 'imagen_file' in request.files:
        file = request.files['imagen_file']
        if file and file.filename != '' and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            ext = filename.rsplit('.', 1)[1].lower()
            unique_filename = f"{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique_filename))
            imagen_url = f"/static/uploads/{unique_filename}"

    nueva = Consumicion(
        nombre=nombre,
        precio_unitario=precio,
        imagen_url=imagen_url if imagen_url else None,
        activo=True
    )
    db.session.add(nueva)
    db.session.commit()
    return jsonify(nueva.to_dict()), 201

@app.route('/api/consumiciones/<int:item_id>', methods=['PUT'])
def edit_consumicion(item_id):
    if not check_auth(request):
        return jsonify({'error': 'Acceso non autorizado'}), 401

    item = Consumicion.query.get_or_404(item_id)
    
    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio_unitario', '')
    activo_str = request.form.get('activo', '')

    if nombre:
        item.nombre = nombre
    
    if precio_str:
        try:
            precio = float(precio_str)
            if precio > 0:
                item.precio_unitario = precio
        except ValueError:
            pass

    if activo_str != '':
        item.activo = (activo_str.lower() == 'true')

    if 'imagen_file' in request.files:
        file = request.files['imagen_file']
        if file and file.filename != '' and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            ext = filename.rsplit('.', 1)[1].lower()
            unique_filename = f"{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique_filename))
            item.imagen_url = f"/static/uploads/{unique_filename}"
    elif 'imagen_url' in request.form:
        url = request.form.get('imagen_url', '').strip()
        if url:
            item.imagen_url = url

    db.session.commit()
    return jsonify(item.to_dict())

@app.route('/api/consumiciones/<int:item_id>', methods=['DELETE'])
def delete_consumicion(item_id):
    if not check_auth(request):
        return jsonify({'error': 'Acceso non autorizado'}), 401

    item = Consumicion.query.get_or_404(item_id)
    # Soft delete: activo = False
    item.activo = False
    db.session.commit()
    return jsonify({'success': True, 'message': 'Consumición desactivada correctamente'})

@app.route('/api/pedidos', methods=['POST'])
def create_pedido():
    data = request.get_json() or {}
    items_pedidos = data.get('items', [])
    camarero = data.get('camarero', 'Camarero 1')

    if not items_pedidos:
        return jsonify({'error': 'O pedido está baleiro'}), 400

    try:
        # Transacción atómica
        with db.session.begin_nested():
            total_acumulado = 0.0
            lineas_db = []

            for item_draft in items_pedidos:
                cid = item_draft.get('id')
                cantidad = int(item_draft.get('cantidad', 0))

                if cantidad <= 0:
                    continue

                consumicion = Consumicion.query.get(cid)
                if not consumicion:
                    continue

                subtotal = cantidad * consumicion.precio_unitario
                total_acumulado += subtotal

                linea = PedidoLinea(
                    consumicion_id=consumicion.id,
                    cantidad=cantidad,
                    precio_unitario_en_el_momento=consumicion.precio_unitario
                )
                lineas_db.append(linea)

            if not lineas_db:
                return jsonify({'error': 'Ningún elemento válido no pedido'}), 400

            nuevo_pedido = Pedido(
                fecha_hora=datetime.utcnow(),
                total_pedido=round(total_acumulado, 2),
                camarero=camarero,
                lineas=lineas_db
            )
            db.session.add(nuevo_pedido)

        db.session.commit()
        return jsonify({
            'success': True,
            'pedido_id': nuevo_pedido.id,
            'total_pedido': nuevo_pedido.total_pedido,
            'message': f'Pedido gardado correctamente: {nuevo_pedido.total_pedido:.2f} €'
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erro ao gardar o pedido: {str(e)}'}), 500

@app.route('/api/resultados', methods=['GET'])
def get_resultados():
    if not check_auth(request):
        return jsonify({'error': 'Acceso non autorizado'}), 401

    # Facturación total e número de pedidos
    total_facturacion = db.session.query(func.coalesce(func.sum(Pedido.total_pedido), 0.0)).scalar()
    total_pedidos_count = Pedido.query.count()

    # Agregación por consumición
    # Traer todas as consumicións (activas e inactivas) para incluír todo o histórico
    todas_consumiciones = Consumicion.query.all()
    
    # Calcular unidades e € facturados por consumicion_id
    query_agregada = db.session.query(
        PedidoLinea.consumicion_id,
        func.sum(PedidoLinea.cantidad).label('unidades_totales'),
        func.sum(PedidoLinea.cantidad * PedidoLinea.precio_unitario_en_el_momento).label('importe_total')
    ).group_by(PedidoLinea.consumicion_id).all()

    stats_map = {row.consumicion_id: {'unidades': row.unidades_totales or 0, 'importe': float(row.importe_total or 0.0)} for row in query_agregada}

    resultados_lista = []
    for c in todas_consumiciones:
        st = stats_map.get(c.id, {'unidades': 0, 'importe': 0.0})
        pct = (st['importe'] / total_facturacion * 100) if total_facturacion > 0 else 0.0
        resultados_lista.append({
            'id': c.id,
            'nombre': c.nombre,
            'precio_actual': round(c.precio_unitario, 2),
            'activo': c.activo,
            'unidades_vendidas': st['unidades'],
            'importe_facturado': round(st['importe'], 2),
            'porcentaje_facturacion': round(pct, 1)
        })

    # Ordenar por importe facturado descendente
    resultados_lista.sort(key=lambda x: x['importe_facturado'], reverse=True)

    return jsonify({
        'facturacion_total': round(total_facturacion, 2),
        'total_pedidos': total_pedidos_count,
        'productos': resultados_lista
    })

@app.route('/api/reset-caja', methods=['POST'])
def reset_caja():
    if not check_auth(request):
        return jsonify({'error': 'Acceso non autorizado'}), 401

    try:
        # Cierre de caja: elimínanse os pedidos e liñas (ou reinícianse os contadores)
        db.session.query(PedidoLinea).delete()
        db.session.query(Pedido).delete()
        db.session.commit()
        return jsonify({'success': True, 'message': 'Cesta e historial de ventas reiniciados con éxito'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Erro ao pechar caixa: {str(e)}'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
