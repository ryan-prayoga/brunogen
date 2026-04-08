<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProjectMethodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'uuid' => 'project-method-1',
            'name' => $this->name,
            'owner_email' => $this->owner_email,
        ];
    }
}
