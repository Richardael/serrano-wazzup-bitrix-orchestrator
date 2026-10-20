export const NOTIFICATION_MARKER_REPOSITORY = "NOTIFICATION_MARKER_REPOSITORY";

export interface NotificationMarker {
  /** Telefono canonico: solo digitos, con codigo de pais. */
  phoneKey: string;
  sentAt: Date;
  source: string;
  messageId: string | null;
}

export interface NotificationMarkerRepository {
  /** Crea o renueva la marca de un telefono: `sentAt` pasa a ser ahora. */
  register(input: { phoneKey: string; source: string; messageId: string | null; sentAt: Date }): Promise<void>;

  /** Marcas de esos telefonos enviadas en `notBefore` o despues. */
  findActive(phoneKeys: readonly string[], notBefore: Date): Promise<NotificationMarker[]>;

  /** Cuenta una respuesta suprimida (solo para visibilidad operativa). */
  recordReply(phoneKey: string, at: Date): Promise<void>;
}
