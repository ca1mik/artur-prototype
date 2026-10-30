import { UserRepository } from "../repositories/userRepository";

export class UserService {
  private userRepository = new UserRepository();

  async findOrCreateCustomer(telegramId: number, phone: string | null) {
    const existing = await this.userRepository.findByTelegramId(telegramId);
    if (existing) {
      return existing;
    }
    return this.userRepository.createCustomerUser(telegramId, phone);
  }

  async findOrCreateCarrier(telegramId: number, phone: string | null) {
    const existing = await this.userRepository.findByTelegramId(telegramId);
    if (existing) {
      return existing;
    }
    return this.userRepository.createCarrierUser(telegramId, phone);
  }

  async updatePhone(userId: number, phone: string) {
    return this.userRepository.updatePhone(userId, phone);
  }
}
