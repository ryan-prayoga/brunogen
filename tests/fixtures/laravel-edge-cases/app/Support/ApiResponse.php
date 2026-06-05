<?php

namespace App\Support;

class ApiResponse
{
    public static function created(array $payload)
    {
        return response()->json([
            'message' => 'Report created',
            'data' => $payload,
        ], 201);
    }
}
