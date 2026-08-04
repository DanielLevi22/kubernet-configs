import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { createWriteStream } from 'fs';
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    console.log("env", process.env.APP)
    console.log("env", process.env.API_KEY)
    return this.appService.getHello();
  }
  @Get('k8s')
  getExample(): string {
    const file = createWriteStream('test.txt')

    for (let index = 0; index < 10000; index++) {
      file.write("escrevendo texto stream test")
    }
    
    file.end()
    return this.appService.getExample();
  }
}
