# Getting started

Create a pet, then list pets.

```http
POST /pets HTTP/1.1
Host: api.example.com
Content-Type: application/json

{"name":"Ada","tag":"demo"}
```

```http
GET /pets HTTP/1.1
Host: api.example.com
```

Full request/response contracts live in the [API Reference](/api-reference/), including [listPets](/api-reference/operations/listPets/) and the [Pet](/api-reference/schemas/Pet/) schema.

See also the [error model](./03-errors.md).
