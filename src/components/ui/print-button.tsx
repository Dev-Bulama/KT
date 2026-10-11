"use client";

import { Printer } from "lucide-react";
import { Button } from "./button";

export function PrintButton() {
  return <Button variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print</Button>;
}
