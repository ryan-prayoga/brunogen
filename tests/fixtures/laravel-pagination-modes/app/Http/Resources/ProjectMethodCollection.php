<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\ResourceCollection;

class ProjectMethodCollection extends ResourceCollection
{
    protected function collects()
    {
        return ProjectMethodResource::class;
    }

    public function toArray(Request $request): array
    {
        return [
            'data' => $this->collection,
            'meta' => [
                'source' => 'method_collection',
            ],
        ];
    }
}
