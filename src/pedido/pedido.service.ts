import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { UpdatePedidoDto } from './dto/update-pedido.dto';
import { Pedido, PedidoDocument } from './schemas/pedido.schema';
import { ClienteProfileService } from '../cliente-profile/cliente-profile.service';
import { ProductoService } from '../producto/producto.service';
import { Role } from '../auth/enums/roles.enum';

@Injectable()
export class PedidoService {
  constructor(
    @InjectModel(Pedido.name) private pedidoModel: Model<PedidoDocument>,
    private clienteProfileService: ClienteProfileService,
    private productoService: ProductoService,
  ) {}

  async create(createPedidoDto: CreatePedidoDto, userId: string): Promise<Pedido> {
    let clienteId: string;

    // 1. Determinar el cliente
    if (createPedidoDto.cliente) {
      // Si se especificó un cliente (caso ADMIN), usarlo directamente
      clienteId = createPedidoDto.cliente;
    } else {
      // Si no, buscar el ClienteProfile del usuario autenticado
      const clienteProfile = await this.clienteProfileService.findByUserId(userId);
      clienteId = (clienteProfile as any)._id.toString();
    }

    // 2. Buscar cada producto y calcular precio
    const itemsConPrecio = await Promise.all(
      createPedidoDto.items.map(async (item) => {
        const producto = await this.productoService.findOne(item.producto);
        return {
          producto: new Types.ObjectId(item.producto),
          cantidad: item.cantidad,
          precio: producto.precio, // Usar el precio actual del producto
        };
      })
    );

    // 3. Calcular total
    const total = itemsConPrecio.reduce(
      (sum, item) => sum + item.precio * item.cantidad,
      0
    );

    // 4. Crear el pedido
    const nuevoPedido = await this.pedidoModel.create({
      cliente: new Types.ObjectId(clienteId),
      items: itemsConPrecio,
      total,
      direccionEntrega: createPedidoDto.direccionEntrega,
      notasEntrega: createPedidoDto.notasEntrega,
    });

    return nuevoPedido;
  }

  async findAll(): Promise<Pedido[]> {
    const pedidos = await this.pedidoModel.find().populate('cliente', 'nombre email telefono');
    return pedidos;
  }

  async findOne(id: string | number): Promise<Pedido> {
    const pedido = await this.pedidoModel.findById(id).populate('cliente', 'nombre email telefono');
    if (!pedido) {
      throw new NotFoundException(`Pedido con ID ${id} no encontrado`);
    }
    return pedido;
  }

  async update(id: string | number, updatePedidoDto: UpdatePedidoDto): Promise<Pedido> {
    const pedido = await this.pedidoModel.findByIdAndUpdate(id, updatePedidoDto, { new: true }).populate('cliente', 'nombre email telefono')
    if (!pedido) {
      throw new NotFoundException(`Pedido con ID ${id} no encontrado`);
    }
    return pedido;
  }

  async remove(id: string | number): Promise<void> {
    const result = await this.pedidoModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException(`Pedido con ID ${id} no encontrado`);
    }
  }

  async findByCliente(
    clienteId: string,
    requester?: { userId: string; role: Role },
  ): Promise<Pedido[]> {
    if (requester && requester.role !== Role.ADMIN) {
      const clienteProfile = await this.clienteProfileService.findByUserId(requester.userId);
      const requesterClienteId = (clienteProfile as any)?._id?.toString();
      if (!requesterClienteId || requesterClienteId !== clienteId) {
        throw new ForbiddenException('No tienes acceso a estos pedidos');
      }
    }

    const pedidos = await this.pedidoModel.find({ cliente: new Types.ObjectId(clienteId) })
      .populate('cliente', 'nombre email telefono')
      .populate('items.producto', 'nombre precio imagen')
      .sort({ createdAt: -1 });
    return pedidos;
  }

  async crearDesdeCarrito(carritoDto: CreatePedidoDto, userId: string): Promise<Pedido> {
    // Reutilizamos la lógica de create para calcular precios y determinar cliente
    return this.create(carritoDto, userId);
  }
}
