import { createDeleteUserStorageHandler } from "../_shared/delete-user-storage-handler.ts";

Deno.serve(createDeleteUserStorageHandler());
