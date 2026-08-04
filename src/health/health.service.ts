import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  checkHeath(): string {
    console.log("chequei a saide do app")
    return 'ok';
  }

  checkReady(): string {
    console.log("chequei a prontidao do app")
    return 'Ready!';
  }
}
