import { Controller, Get, Post, HttpCode } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok_V3_NEW_CODE", timestamp: new Date().toISOString() };
  }

  @Post("wazzup-verify")
  @HttpCode(200)
  wazzupVerify() {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return { status: "ready", timestamp: new Date().toISOString() };
  }
}
