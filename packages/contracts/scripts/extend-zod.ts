import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Zod 4 copies prototype methods onto each schema when it is constructed, so
// `.openapi()` only exists on schemas created after this runs. ESM evaluates
// imports in order: this module must be the generator's first import.
extendZodWithOpenApi(z);
